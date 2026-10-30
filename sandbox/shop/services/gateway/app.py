"""API gateway: the only service the storefront talks to."""
from shoplib import Request, Service

svc = Service("gateway")


@svc.route("GET", "/api/products")
def products(req: Request):
    return 200, req.call("catalog", "GET", "/products")


@svc.route("GET", "/api/cart")
def cart(req: Request):
    return 200, req.call("cart", "GET", "/cart")


@svc.route("POST", "/api/cart")
def add(req: Request):
    return 200, req.call("cart", "POST", "/cart", req.body)


@svc.route("POST", "/api/checkout")
def checkout(req: Request):
    return 200, req.call("checkout", "POST", "/checkout", req.body)


if __name__ == "__main__":
    svc.serve()
