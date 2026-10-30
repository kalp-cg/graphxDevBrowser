"""A ground-truth benchmark for the codebase scanner.

Each case writes a small repository in a layout seen in real projects and states, by hand, what a person reading it would
say it contains: its services, databases and which service calls which. The scanner is scored on exactly that: precision
(what it reports is right) and recall (it found everything). These repositories are synthetic: they pin down the layouts we
know about, they do not prove accuracy on yours. `scripts/benchmark.py --repo PATH --truth FILE` scores a real repository
against a truth file you wrote.
"""
from dataclasses import dataclass, field
from pathlib import Path


@dataclass
class Case:
    name: str
    files: dict[str, str]
    services: set[str]
    databases: set[str] = field(default_factory=set)
    edges: set[tuple[str, str]] = field(default_factory=set)
    ignored: set[str] = field(default_factory=set)


def _write(root: Path, files: dict[str, str]) -> None:
    for rel, text in files.items():
        f = root / rel
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_text(text)


CASES: list[Case] = [
    Case("compose: depends_on, service URLs, a database", {
        "docker-compose.yml": """services:
  web: {build: ./web, ports: ['3000:3000'], environment: [API_URL=http://api:8000]}
  api: {build: ./api, depends_on: [db, cache], environment: ['PAYMENTS=http://payments:9000/v1']}
  payments: {build: ./payments}
  db: {image: 'postgres:16'}
  cache: {image: redis}
""",
        "web/package.json": "{}", "api/requirements.txt": "", "payments/go.mod": "module p\n"},
        services={"web", "api", "payments"}, databases={"db", "cache"},
        edges={("web", "api"), ("api", "db"), ("api", "cache"), ("api", "payments")}),

    Case("compose: variables from .env, unquoted in flow lists, monitoring left out", {
        ".env": "API_PORT=8080\nTAG=1.2\n",
        "docker-compose.yml": """services:
  gateway: {build: ./gateway, ports: ['${API_PORT}:8080'], environment: [UPSTREAM=http://orders:${API_PORT}], depends_on: [orders]}
  orders: {build: ./orders, environment: [DB=postgres://u:p@ordersdb:5432/o]}
  ordersdb: {image: 'postgres:${TAG}'}
  otel-collector: {image: otel/opentelemetry-collector-contrib}
  prometheus: {image: prom/prometheus}
  load-generator: {build: ./loadgen}
""",
        "gateway/go.mod": "module g\n", "orders/pom.xml": "", "loadgen/requirements.txt": ""},
        services={"gateway", "orders"}, databases={"ordersdb"}, edges={("gateway", "orders"), ("orders", "ordersdb")},
        ignored={"otel-collector", "prometheus", "load-generator"}),

    Case("compose in deploy/, contexts relative to it", {
        "deploy/docker/docker-compose.yml": """services:
  front: {build: ../../apps/front, depends_on: [back]}
  back: {build: {context: ../../apps/back}, depends_on: [mq]}
  mq: {image: rabbitmq:3}
""",
        "apps/front/package.json": "{}", "apps/back/package.json": "{}"},
        services={"front", "back"}, databases={"mq"}, edges={("front", "back"), ("back", "mq")}),

    Case("monorepo built from the root: Dockerfiles in src/<service>, polyglot", {
        ".env": "CHECKOUT_DOCKERFILE=./src/checkout/Dockerfile\nCART_DOCKERFILE=./src/cart/Dockerfile\n",
        "compose.yaml": """services:
  checkout: {build: {context: ./, dockerfile: '${CHECKOUT_DOCKERFILE}'}, depends_on: [cart, flagd]}
  cart: {build: {context: ./, dockerfile: '${CART_DOCKERFILE}'}, environment: ['STORE=valkey-cart:6379']}
  valkey-cart: {image: valkey/valkey:7}
  flagd: {image: ghcr.io/open-feature/flagd:v0}
""",
        "src/checkout/Dockerfile": "FROM golang:1.22\n", "src/checkout/go.mod": "module c\n",
        "src/cart/Dockerfile": "FROM mcr.microsoft.com/dotnet/aspnet:8.0\n", "src/cart/Cart.csproj": ""},
        services={"checkout", "cart"}, databases={"valkey-cart"}, edges={("checkout", "cart"), ("cart", "valkey-cart")},
        ignored={"flagd"}),

    Case("kubernetes manifests, no compose", {
        "k8s/frontend.yaml": """apiVersion: apps/v1
kind: Deployment
metadata: {name: frontend}
spec:
  selector: {matchLabels: {app: frontend}}
  template:
    spec:
      containers:
      - name: c
        image: frontend
        env:
        - {name: CART_ADDR, value: 'cartservice:7070'}
        - {name: ADS_ADDR, value: 'http://adservice:9555'}
---
apiVersion: v1
kind: Service
metadata: {name: frontend-external}
spec: {type: LoadBalancer, selector: {app: frontend}, ports: [{port: 80}]}
""",
        "k8s/cart.yaml": """apiVersion: apps/v1
kind: Deployment
metadata: {name: cartservice}
spec:
  selector: {matchLabels: {app: cartservice}}
  template:
    spec:
      containers:
      - name: c
        image: cartservice
        env:
        - {name: REDIS_ADDR, value: 'redis-cart:6379'}
""",
        "k8s/ads.yaml": """apiVersion: apps/v1
kind: Deployment
metadata: {name: adservice}
spec:
  selector: {matchLabels: {app: adservice}}
  template:
    spec: {containers: [{name: c, image: adservice}]}
""",
        "k8s/redis.yaml": """apiVersion: apps/v1
kind: Deployment
metadata: {name: redis-cart}
spec:
  selector: {matchLabels: {app: redis-cart}}
  template:
    spec: {containers: [{name: redis, image: 'redis:alpine'}]}
""",
        "src/frontend/go.mod": "module f\n", "src/cartservice/Cart.csproj": "", "src/adservice/build.gradle": ""},
        services={"frontend", "cartservice", "adservice"}, databases={"redis-cart"},
        edges={("frontend", "cartservice"), ("frontend", "adservice"), ("cartservice", "redis-cart")}),

    Case("a Next.js monolith: modules, imports, a database, an outside API", {
        "package.json": '{"dependencies":{"next":"14","@prisma/client":"5"}}',
        "tsconfig.json": '{"compilerOptions":{"paths":{"@/*":["./*"]}}}',
        "prisma/schema.prisma": 'datasource db {\n provider = "postgresql"\n url = env("DATABASE_URL")\n}',
        "lib/db.ts": "import { PrismaClient } from '@prisma/client'\nexport const db = new PrismaClient()",
        "lib/ai/chat.ts": "import { db } from '@/lib/db'\nconst k = process.env.OPENAI_API_KEY\nexport const chat = () => db",
        "lib/billing/invoice.ts": "import { chat } from '../ai/chat'\nexport const inv = chat",
        "app/api/orders/route.ts": "import { inv } from '@/lib/billing/invoice'\nexport const GET = inv",
        "app/api/health/route.ts": "export const GET = () => 'ok'",
        "app/page.tsx": "import Nav from '@/components/Nav'\nexport default Nav",
        "components/Nav.tsx": "export default () => null",
        "next.config.ts": "export default {}", "lib/ai/chat.test.ts": "import { chat } from './chat'"},
        services={"lib", "lib.ai", "lib.billing", "api.orders", "api.health", "app", "components", "openai-api"},
        databases={"prisma-db"},
        edges={("lib.ai", "lib"), ("lib.billing", "lib.ai"), ("api.orders", "lib.billing"), ("app", "components"),
               ("lib.ai", "openai-api"), ("lib", "prisma-db")}),

    Case("a Python monolith: packages, imports, a database driver", {
        "requirements.txt": "psycopg2\n",
        "orders/__init__.py": "", "orders/views.py": "from billing.service import charge\nfrom common.util import fmt\n",
        "billing/__init__.py": "", "billing/service.py": "import psycopg2\nfrom common.util import fmt\n",
        "common/__init__.py": "", "common/util.py": "def fmt(x): return x\n",
        "tests/test_x.py": "from orders.views import *"},
        services={"orders", "billing", "common"}, databases={"postgres"},
        edges={("orders", "billing"), ("orders", "common"), ("billing", "common"), ("billing", "postgres")}),

    Case("no compose: package folders under services/, a container folder is not a service", {
        "services/auth/package.json": "{}", "services/billing/go.mod": "module b\n", "services/billing/cmd/main.go": "package main",
        "svc/legacy/pom.xml": "", "docs/index.md": "x"},
        services={"auth", "billing", "legacy"}),
]


def build(case: Case, root: Path) -> Path:
    _write(root, case.files)
    return root


def score(truth: set, found: set) -> tuple[float, float]:
    """(precision, recall); an empty set on both sides is a perfect, vacuous match."""
    if not truth and not found:
        return 1.0, 1.0
    hit = len(truth & found)
    return (hit / len(found) if found else 0.0), (hit / len(truth) if truth else 1.0)
