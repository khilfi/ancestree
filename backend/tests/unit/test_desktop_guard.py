"""Only the app's own window reaches the engine."""

import httpx
import pytest
from fastapi import FastAPI

from ancestree.desktop.guard import COOKIE, ENTER, SessionGuard

SECRET = "s" * 43
PORT = 51234
HERE = f"http://127.0.0.1:{PORT}"

pytestmark = pytest.mark.anyio


def guarded() -> FastAPI:
    app = FastAPI()

    @app.get("/api/health")
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/tree")
    async def page() -> dict[str, str]:
        return {"page": "tree"}

    app.add_middleware(SessionGuard, secret=SECRET, port=PORT)
    return app


def client(base: str = HERE) -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=guarded()), base_url=base)


async def test_without_the_window_s_cookie_nothing_answers() -> None:
    async with client() as engine:
        for path in ("/api/health", "/tree", "/"):
            refused = await engine.get(path)
            assert refused.status_code == 403
            assert refused.json()["detail"]["code"] == "not_this_window"


async def test_the_window_enters_with_the_secret_and_then_everything_answers() -> None:
    async with client() as engine:
        entered = await engine.get(ENTER, params={"secret": SECRET, "to": "/tree"})
        assert entered.status_code == 303
        assert entered.headers["location"] == "/tree"
        cookie = entered.headers["set-cookie"].lower()
        assert f"{COOKIE}=" in cookie
        assert "httponly" in cookie
        assert "samesite=lax" in cookie  # WebKit holds back a Strict one after the redirect
        assert "path=/" in cookie

        assert (await engine.get("/api/health")).json() == {"status": "ok"}
        assert (await engine.get("/tree")).json() == {"page": "tree"}


async def test_a_wrong_secret_gets_no_cookie() -> None:
    async with client() as engine:
        refused = await engine.get(ENTER, params={"secret": "x" * 43})
        assert refused.status_code == 403
        assert "set-cookie" not in refused.headers
        assert (await engine.get("/api/health")).status_code == 403


async def test_another_host_is_refused_even_with_the_cookie() -> None:
    async with client("http://attacker.example:51234") as engine:
        engine.cookies.set(COOKIE, SECRET)
        refused = await engine.get("/api/health")
        assert refused.status_code == 403
        assert refused.json()["detail"]["message"] == "Not for this address"


async def test_entering_only_leads_to_this_app_s_own_pages() -> None:
    async with client() as engine:
        for elsewhere in ("https://example.org/", "//example.org/", "/\\example.org"):
            entered = await engine.get(ENTER, params={"secret": SECRET, "to": elsewhere})
            assert entered.headers["location"] == "/"


def test_a_short_secret_is_refused() -> None:
    with pytest.raises(ValueError, match="too short"):
        SessionGuard(guarded(), secret="short", port=PORT)
