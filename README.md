# AncesTree

A family-history app for one family, on its own computers. Add relatives with their photos and life stories, link them by dragging arrows, and see the family laid out in rings around its oldest ancestor, as a family tree, on a timeline or on a map. Ask how any two people are related, and get the answer in English, Malay or Javanese, with the path between them highlighted.

- **Private by design.** The family lives on your computer, in a database of its own. The app sends nothing about it anywhere. It asks the internet only whether there's a new version of itself, and, the first time it starts, for its database.
- **Windows, macOS (Apple Silicon) and Linux.**

## Install

Download the installer for your system from the [latest release](../../releases/latest).

| System | File | The first time |
|---|---|---|
| Windows | `AncesTree_<version>_x64-setup.exe` | The installer isn't signed, so Windows says "Windows protected your PC". Choose **More info**, then **Run anyway**. |
| macOS | `AncesTree_<version>_aarch64.dmg` | The app isn't signed by Apple. Open it once, then go to **System Settings → Privacy & Security** and choose **Open Anyway**. |
| Linux | `AncesTree_<version>_amd64.AppImage` | Make it executable (`chmod +x`), then run it. |

The first start fetches the app's database, Neo4j Community, and the Java it runs on: about 330 MB, once. Both are checked against fingerprints built into the app before they're used.

## Updates

AncesTree looks for a new version now and then, or when you ask in **Settings → About**. When there is one, it offers to restart into it, and otherwise installs it the next time it starts. Every update is signed by the app's maintainer, and the app refuses one that isn't.

## Building it

You need Node.js 24 with pnpm, Python 3.14 with uv, and Rust with Tauri's prerequisites for your system. Then:

```sh
cd frontend && pnpm install && pnpm build && pnpm build:viewer
cd ../backend && uv run --with pyinstaller pyinstaller ../desktop/engine/engine.spec --noconfirm --distpath ../desktop/engine/dist --workpath ../desktop/engine/build
cd ../desktop && pnpm install && pnpm tauri build
```

GitHub Actions builds and checks it on all three systems (`.github/workflows/desktop.yml`), and builds each release from its tag (`release.yml`).

## This repository

It holds the app's code and a made-up test family, never a real family's data. It takes changes from its maintainer only.

Neo4j Community Edition, which AncesTree fetches on its first start, is made by Neo4j, Inc. and licensed under the GNU General Public License v3; its source is at [github.com/neo4j/neo4j](https://github.com/neo4j/neo4j). Its Java runtime is Eclipse Temurin, from [adoptium.net](https://adoptium.net).
