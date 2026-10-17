"""No release left unoffered.

A release is offered to every install only once its signed `updates/latest.json` is pushed. If
that push is forgotten, as 0.8.3's was for a night, no install hears of the release. Run each day
and after every release by `.github/workflows/offer-check.yml`, this compares the newest
release of the app with the version `latest.json` offers, and fails, so GitHub emails, when a
release has waited unoffered for over 6 hours.

    python scripts/unoffered.py [the repository's folder]

It reads the releases from GitHub's API, `GITHUB_API_URL` and `GITHUB_REPOSITORY` as Actions
sets them, with `GITHUB_TOKEN` where given. Only the app's releases count, `v0.8.3` and the
like, never the map's or the places'. Python's standard library alone, so it runs anywhere.
"""

import json
import os
import re
import sys
import urllib.request
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

WAIT = timedelta(hours=6)
_APP = re.compile(r"v(\d+)\.(\d+)\.(\d+)")

type Release = dict[str, Any]  # as GitHub's API gives one


def version_of(text: str) -> tuple[int, int, int] | None:
    """`v0.8.3` or `0.8.3` as numbers to compare; None for anything else."""
    found = _APP.fullmatch(text if text.startswith("v") else f"v{text}")
    return (int(found[1]), int(found[2]), int(found[3])) if found else None


def newest(releases: list[Release]) -> Release | None:
    """The app's newest published release: no draft, no pre-release, nor the map's packs."""
    apps = [
        release
        for release in releases
        if not release.get("draft")
        and not release.get("prerelease")
        and version_of(str(release.get("tag_name", ""))) is not None
    ]
    return max(apps, key=lambda release: version_of(release["tag_name"]) or (0, 0, 0), default=None)


def waiting(releases: list[Release], offered: str, now: datetime) -> tuple[bool, str]:
    """Whether a release has waited unoffered too long, and what to say either way."""
    release = newest(releases)
    if release is None:
        return False, "No release of the app yet."
    tag = str(release["tag_name"])
    on_offer = version_of(offered)
    if on_offer is not None and on_offer >= (version_of(tag) or (0, 0, 0)):
        return False, f"{tag[1:]} is on offer to every install."
    published = datetime.fromisoformat(str(release["published_at"]).replace("Z", "+00:00"))
    hours = (now - published).total_seconds() / 3600
    if now - published <= WAIT:
        return False, (
            f"{tag[1:]} was released {hours:.1f} hours ago and isn't on offer yet ({offered} is): "
            "it's signed and offered with release.py, then pushed."
        )
    return True, (
        f"{tag[1:]} was released {hours:.0f} hours ago, but every install is still offered "
        f"{offered}: no install hears of {tag[1:]} until its signed updates/latest.json is "
        "pushed. Sign it with release.py, then push the offer it writes."
    )


def releases_on_github() -> list[Release]:
    api = os.environ.get("GITHUB_API_URL", "https://api.github.com")
    if not api.startswith(("https://", "http://127.0.0.1:")):
        raise SystemExit(f"Not an address to read releases from: {api}")
    repository = os.environ["GITHUB_REPOSITORY"]
    request = urllib.request.Request(  # noqa: S310 (https, or a test's stand-in, as above)
        f"{api}/repos/{repository}/releases?per_page=50",
        headers={"Accept": "application/vnd.github+json"},
    )
    if token := os.environ.get("GITHUB_TOKEN"):
        request.add_header("Authorization", f"Bearer {token}")
    with urllib.request.urlopen(request, timeout=30) as answer:  # noqa: S310 (https, or a test's stand-in)
        return list(json.load(answer))


def main(argv: list[str] | None = None, now: datetime | None = None) -> int:
    given = sys.argv[1:] if argv is None else argv
    folder = Path(given[0] if given else ".")
    offered = json.loads((folder / "updates" / "latest.json").read_text("utf-8"))["version"]
    late, said = waiting(releases_on_github(), str(offered), now or datetime.now(UTC))
    print(f"::error::{said}" if late else said)
    return 1 if late else 0


if __name__ == "__main__":
    sys.exit(main())
