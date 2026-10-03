# AncesTree

A family-history app for your family, on its own computers. Add relatives with their photos and life stories, link them by dragging arrows, and see the family laid out in rings around its oldest ancestor, as a family tree, on a timeline or on a map. Ask how any two people are related, and get the answer in English, Malay or Javanese, with the path between them highlighted.

- **Private by design.** The family lives on your computer, in a database of its own. On its own, the app asks the internet only whether there's a new version of itself, and, the first time it starts, for its database. Nothing about the family leaves the computer, unless the family keeps its AncesTree in step through Google Drive, and then only encrypted. See the [privacy policy](PRIVACY.md).
- **Every family its own.** Whoever installs AncesTree keeps their own family, as its keeper, through their own Google account and Google project. No family goes through anyone else's, this repository's maintainer's included.
- **For the whole family.** One relative keeps the family; the others' computers receive it, and send their changes for the keeper to look at.
- **Several families on one computer**, such as both sides of yours, each kept completely apart.
- **Windows, macOS (Apple Silicon) and Linux.**

## Install

Download the installer for your system from the [latest release](../../releases/latest). **[The guide](GUIDE.md)** takes you through each step, and each warning your computer shows: installing, starting the family folder or joining it, updates, and what to do when something goes wrong.

| System | File | The first time |
|---|---|---|
| Windows | `AncesTree_<version>_x64-setup.exe` | The installer isn't signed, so Windows says "Windows protected your PC". Choose **More info**, then **Run anyway**. |
| macOS | `AncesTree_<version>_aarch64.dmg` | The app isn't signed by Apple. Open it once, then go to **System Settings → Privacy & Security** and choose **Open Anyway**. |
| Linux | `AncesTree_<version>_amd64.AppImage` | Make it executable (`chmod +x`), then run it. |

The first start fetches the app's database, Neo4j Community, and the Java it runs on: about 330 MB, once. Both are checked against fingerprints built into the app before they're used.

## The family folder

A family can have its AncesTree on each relative's computer, kept in step through a private folder in the keeper's Google Drive (**Settings → Family folder**):

- **The keeper** sets up the family's own Google project once: free, in about 20 minutes, as [the guide](GUIDE.md#your-familys-google-project) shows step by step. Then they start the family's folder from AncesTree, and invite each relative by their Google account, sending them the invitation AncesTree makes.
- **A relative** installs AncesTree, pastes the invitation, signs in to Google, and asks to join. The keeper checks a short code with them, then lets their computer in, and chooses what it may do: change the family, with the keeper looking at each change first, or with its changes coming in by themselves unless they clash; or only receive it.
- **The family arrives by itself** on each computer while AncesTree is open, photos and stories too. What a relative changes waits for the keeper; what the keeper takes reaches everyone.
- **Everything in Google Drive is encrypted** on each computer first, with the family's own keys: Google keeps the files, but can't read them. A computer the keeper removes can't read what comes after.
- **Nothing is lost with a computer, or with the folder.** If the family folder is lost from Drive, the keeper's computer makes it again, and relatives' computers follow it. Backups can be copied to a USB stick or a cloud's folder, locked with a password.

Google says it hasn't verified AncesTree when you sign in: the family's Google project is its keeper's own, made for one family, so it isn't. Choose **Advanced**, then **Go to AncesTree (unsafe)**. [The guide](GUIDE.md) shows how the keeper sets up the project, starts the folder and invites relatives, and how a relative joins.

## Updates

AncesTree looks for a new version now and then, or when you ask in **Settings → About**. When there is one, it offers to restart into it, and otherwise installs it the next time it starts. Every update is signed by the app's maintainer, and the app refuses one that isn't.

## Building it

You need Node.js 24 with pnpm, Python 3.14 with uv, and Rust with Tauri's prerequisites for your system. Then:

```sh
cd frontend && pnpm install && pnpm build && pnpm build:viewer
cd ../backend && uv run --with pyinstaller pyinstaller ../desktop/engine/engine.spec --noconfirm --distpath ../desktop/engine/dist --workpath ../desktop/engine/build
cd ../desktop && pnpm install && pnpm tauri build
```

GitHub Actions builds and checks it on all three systems (`.github/workflows/desktop.yml`), and builds each release from its tag (`release.yml`). No build carries a Google client, a release or one of your own: each family's keeper gives AncesTree their family's own, and relatives receive it in the keeper's invitation.

## This repository

It holds the app's code and a made-up test family, never a real family's data. It takes changes from its maintainer only.

Neo4j Community Edition, which AncesTree fetches on its first start, is made by Neo4j, Inc. and licensed under the GNU General Public License v3; its source is at [github.com/neo4j/neo4j](https://github.com/neo4j/neo4j). Its Java runtime is Eclipse Temurin, from [adoptium.net](https://adoptium.net).
