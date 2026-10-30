"""Payments: charges cards and records each charge."""
from shoplib import Request, Service

svc = Service("payments")


@svc.route("POST", "/charge")
def charge(req: Request):
    req.db("orders-db", "INSERT")
    return 200, {"status": "charged"}


if __name__ == "__main__":
    svc.serve()
