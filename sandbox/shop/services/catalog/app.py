"""Product catalog, read through the cache."""
from shoplib import Request, Service

svc = Service("catalog")
PRODUCTS = [{"sku": "mug", "name": "Graph mug", "price": 14}, {"sku": "tee", "name": "Node tee", "price": 25},
            {"sku": "cap", "name": "Edge cap", "price": 19}]


@svc.route("GET", "/products")
def products(req: Request):
    req.db("cache", "GET")
    return 200, PRODUCTS


if __name__ == "__main__":
    svc.serve()
