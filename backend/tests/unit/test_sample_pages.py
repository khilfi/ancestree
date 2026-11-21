"""The test pages (/sample, /sample/families, ?sample=) and their made-up families, at
/api/sample/…, only where the app is run from the code: never in a release. The
desktop app's engine, packed as every release is, builds the app without them."""

from ancestree.main import create_app

SAMPLES = {
    "/api/sample/graph",
    "/api/sample/map",
    "/api/sample/families",
    "/api/sample/families/backup",
}


def _paths(samples: bool | None = None) -> set[str]:
    app = create_app() if samples is None else create_app(samples=samples)
    return set(app.openapi()["paths"])


def test_a_release_has_no_test_pages_families() -> None:
    paths = _paths(samples=False)
    assert [path for path in paths if path.startswith("/api/sample")] == []
    assert "/api/graph" in paths  # the family's own, as ever
    assert "/api/map" in paths


def test_the_code_has_them_for_the_test_pages() -> None:
    assert _paths(samples=True) >= SAMPLES
    assert _paths() >= SAMPLES  # the API's schema, for the pages' types, has them
