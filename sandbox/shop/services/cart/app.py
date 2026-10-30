"""Shopping carts, kept in the cache."""
from shoplib import Request, Service

svc = Service("cart")
ITEMS: list[dict] = []


@svc.route("GET", "/cart")
def get(req: Request):
    req.db("cache", "GET")
    return 200, {"items": ITEMS[-20:]}


@svc.route("POST", "/cart")
def add(req: Request):
    req.db("cache", "SET")
    ITEMS.append(req.body or {})
    return 200, {"items": ITEMS[-20:]}


if __name__ == "__main__":
    svc.serve()
