# Security

AncesTree keeps a family's history on their own computers, and in a folder in their own Google Drive, locked so that only the family's computers can read it. If you find a way around that, please say so privately first.

## Reporting a problem

Use **Report a vulnerability** on this repository's **Security** tab. Only the maintainer sees it.

Please include:
- the version of AncesTree (**Settings → About**) and the system: Windows, macOS or Linux;
- what someone could do, and the steps to show it;
- nothing of a real family's: use the example family (**Settings → Import → Example (.csv)**).

You'll hear back within a week. A fix goes out as a new version, which installs take by themselves, and the release notes credit you if you'd like.

## What counts

- reaching a family's people, photos, stories, backups or keys without being on one of its computers;
- the app's own engine answering anything but its own window;
- a backup, spreadsheet, photo, story, invitation, view-only copy, or what a relative's computer writes in Drive, making AncesTree do more than it should;
- an update installing that its maintainer didn't sign.

## What doesn't

- someone who already controls the computer, or its user's account;
- a relative the keeper let in seeing the family: that's what being let in means;
- Google, Microsoft or Apple themselves.

Only the latest version is looked after. Updates come by themselves; to look for one now, use **Settings → About → Check for updates**.

## Checking a download

Each release's files are listed with their SHA-256 sums in `SHA256SUMS.txt`, which is signed with AncesTree's update key, the key every install checks updates with. To check that a download is the one its maintainer released:

1. From this repository's `updates/<version>/` folder, download `SHA256SUMS.txt` and `SHA256SUMS.txt.minisig`, beside the file you downloaded.
2. Check the signature with [minisign](https://jedisct1.github.io/minisign/):

   ```
   minisign -Vm SHA256SUMS.txt -P RWTXGNqmlL+M/X+GU62idHfQ6mEu1C39ZdBKztWk4MmiYZkbYcqzqXY4
   ```

   It says `Signature and comment signature verified` when the sums are the maintainer's. The key's id is `FD8CBF94A6DA18D7`.
3. Check your file's sum against its line in `SHA256SUMS.txt`: on Windows, `Get-FileHash <file>` in PowerShell; on a Mac or Linux, `shasum -a 256 <file>`.

Signed sums are there from version 0.4.2 on.
