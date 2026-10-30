"""The storefront: one page that calls the gateway from the browser."""
from pathlib import Path

from shoplib import Service, address

svc = Service("web")
PAGE = (Path(__file__).parent / "static" / "index.html").read_text()
svc.static["/"] = ("text/html; charset=utf-8", PAGE.replace("{{GATEWAY_URL}}", address("gateway")).encode())

if __name__ == "__main__":
    svc.serve()
