"""Checkout: reserves stock, charges the card, places the order."""
import secrets

from shoplib import Request, Service

svc = Service("checkout")


@svc.route("POST", "/checkout")
def checkout(req: Request):
    cart = req.call("cart", "GET", "/cart", fallback={"items": []})
    req.call("inventory", "POST", "/reserve", {"items": cart["items"]})
    # With the breaker into payments open, orders are accepted and charged later.
    charge = req.call("payments", "POST", "/charge", {"amount": 42}, fallback={"status": "deferred"})
    return 200, {"order": secrets.token_hex(4), "payment": charge["status"]}


if __name__ == "__main__":
    svc.serve()
