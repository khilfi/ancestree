"""Only the app's own window reaches the engine.

The engine listens on this computer alone, but any program here could call it, and so could
a web page open in a browser. So each time the app starts, the shell makes a secret, gives
it to the engine, and opens the window at /desktop/enter with it. The engine then gives the
window the secret as a cookie that scripts can't read (HttpOnly); every other request
without it is refused. The cookie exists only in the window's own web view, which opens no
other site. It's SameSite=Lax, not Strict: WebKit, the Mac's and Linux's web view, holds a
Strict cookie back from the page the shell sends the window to, taking that for a step from
another site.

A request that names another host is refused too, whatever it carries. That stops a web
page that makes its own address point at this computer ("DNS rebinding").
"""

from hmac import compare_digest

from starlette.datastructures import Headers, QueryParams
from starlette.responses import JSONResponse, RedirectResponse, Response
from starlette.types import ASGIApp, Receive, Scope, Send

COOKIE = "ancestree_session"
ENTER = "/desktop/enter"


def _refused(message: str) -> Response:
    return JSONResponse(
        {"detail": {"code": "not_this_window", "message": message}}, status_code=403
    )


class SessionGuard:
    """ASGI middleware: the host must be this engine's, and the session cookie its secret."""

    def __init__(self, app: ASGIApp, secret: str, port: int) -> None:
        if len(secret) < 32:
            raise ValueError("the session secret is too short")
        self.app = app
        self.secret = secret
        self.hosts = {f"127.0.0.1:{port}", f"localhost:{port}"}

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] not in ("http", "websocket"):
            await self.app(scope, receive, send)
            return
        headers = Headers(scope=scope)
        if headers.get("host") not in self.hosts:
            await _refused("Not for this address")(scope, receive, send)
            return
        if scope["type"] == "http" and scope["path"] == ENTER:
            await self._enter(scope, receive, send)
            return
        cookies = headers.get("cookie", "")
        sent = next(
            (
                value
                for name, _, value in (part.strip().partition("=") for part in cookies.split(";"))
                if name == COOKIE
            ),
            "",
        )
        if not compare_digest(sent.encode(), self.secret.encode()):
            await _refused("Only the AncesTree app's own window may use this")(scope, receive, send)
            return
        await self.app(scope, receive, send)

    async def _enter(self, scope: Scope, receive: Receive, send: Send) -> None:
        query = QueryParams(scope.get("query_string", b"").decode("latin-1"))
        if not compare_digest(query.get("secret", "").encode(), self.secret.encode()):
            await _refused("Only the AncesTree app's own window may use this")(scope, receive, send)
            return
        where = query.get("to", "/")
        if not where.startswith("/") or where.startswith("//") or "\\" in where:
            where = "/"  # only this app's own pages
        response = RedirectResponse(where, status_code=303)
        response.set_cookie(COOKIE, self.secret, httponly=True, samesite="lax", path="/")
        await response(scope, receive, send)
