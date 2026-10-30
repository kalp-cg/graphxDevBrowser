"""Inventory: stock reservations in the orders database."""
from shoplib import Request, Service

svc = Service("inventory")


@svc.route("POST", "/reserve")
def reserve(req: Request):
    req.db("orders-db", "UPDATE")
    return 200, {"reserved": True}


if __name__ == "__main__":
    svc.serve()
