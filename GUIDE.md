# The AncesTree guide

AncesTree keeps your family's tree on your own computer: everyone in it, how they're related, their photos and life stories. Each relative who joins has the same family on their computer, kept in step through a private folder in Google Drive.

**One person keeps the family: the keeper.** They start the family folder, invite relatives, and look at each change a relative makes before it reaches everyone. Everyone else is a relative.

This guide is for both. Everyone starts at [Install AncesTree](#1-install-ancestree). Then the keeper goes on to [For the keeper](#3-for-the-keeper), and a relative to [For relatives](#4-for-relatives).

**Contents**

1. [Install AncesTree](#1-install-ancestree): [Windows](#on-windows), [Mac](#on-a-mac), [Linux](#on-linux)
2. [The first start](#2-the-first-start)
3. [For the keeper](#3-for-the-keeper)
4. [For relatives](#4-for-relatives)
5. [Updates](#5-updates)
6. [Lock your computer's disk](#6-lock-your-computers-disk)
7. [Where AncesTree keeps the family](#7-where-ancestree-keeps-the-family)
8. [When something goes wrong](#8-when-something-goes-wrong)
9. [Removing AncesTree](#9-removing-ancestree)

## 1. Install AncesTree

**You need:**

- a computer with one of these:
  - **Windows** 10 or 11;
  - **a Mac with Apple Silicon** (an M1 or newer), with macOS 11 or newer;
  - **Linux** on a 64-bit Intel or AMD computer;
- the internet, the first time AncesTree starts: it fetches about 330 MB, once;
- **a Google account**, to join the family. The keeper invites that account, so tell them which one it is.

Phones and tablets can't install AncesTree. The keeper can send them a copy to look at instead (see [Copies to look at](#copies-to-look-at)).

**Download** AncesTree from the [latest release](https://github.com/khilfi/ancestree/releases/latest). Under **Assets**, choose the file for your computer:

| Your computer | The file |
|---|---|
| Windows | `AncesTree_<version>_x64-setup.exe` |
| Mac | `AncesTree_<version>_aarch64.dmg` |
| Linux | `AncesTree_<version>_amd64.AppImage` |

AncesTree is made for one family, so it doesn't carry the paid signature that big companies' programs carry. Your computer warns you about it once, while you install it. Each warning, and what to choose, is below. After that, AncesTree updates itself, and installs only updates signed by its maintainer.

### On Windows

1. **Open the file you downloaded**, `AncesTree_<version>_x64-setup.exe`. It's in your **Downloads** folder.
2. **Windows says "Windows protected your PC".** Choose **More info**, then **Run anyway**.
   <!-- picture: guide/windows-1-protected.png, guide/windows-2-run-anyway.png -->
3. **The installer opens.** Choose **Next**, then **Install**. It installs AncesTree for you alone, so it doesn't ask for an administrator's password.
   <!-- picture: guide/windows-3-installer.png -->
4. **At the end**, keep **Run AncesTree** ticked, and choose **Finish**. Tick **Create desktop shortcut** too if you'd like an icon on your desktop.
   <!-- picture: guide/windows-4-finish.png -->

**If Windows says Smart App Control blocked it**, with no **Run anyway**: Smart App Control is on, and it lets in only programs with that paid signature. To install AncesTree, turn it off:

1. Open **Start**, type **Smart App Control**, and open **Smart App Control settings**.
2. Choose **Off**.
   <!-- picture: guide/windows-5-smart-app-control.png -->
3. Open the installer again.

Turning it off is your choice to make. Windows may not let you turn it back on later without setting up Windows again. Microsoft Defender keeps protecting your computer either way.

### On a Mac

1. **Open the file you downloaded**, `AncesTree_<version>_aarch64.dmg`. It's in your **Downloads** folder.
2. **Drag AncesTree onto the Applications folder** in the window that opens.
   <!-- picture: guide/mac-1-drag-to-applications.png -->
3. **Open AncesTree** from **Applications**. Your Mac says it couldn't check that AncesTree is safe, and doesn't open it. Choose **Done**. Don't choose **Move to Trash**.
   <!-- picture: guide/mac-2-not-opened.png -->
4. **Open System Settings → Privacy & Security.** Scroll down to **Security**, where it says AncesTree was blocked. Choose **Open Anyway**.
   <!-- picture: guide/mac-3-open-anyway.png -->
5. **Your Mac asks once more.** Choose **Open Anyway**, then type your Mac's password, or use Touch ID.
   <!-- picture: guide/mac-4-open-anyway-again.png -->

From then on AncesTree opens like any other app.

### On Linux

1. **Allow the file to run.** Right-click `AncesTree_<version>_amd64.AppImage` and choose **Properties**. Turn on **Executable as Program**, or, on older Linux, tick **Allow executing file as program** under **Permissions**. Or, in a terminal:

   ```sh
   chmod +x AncesTree_*_amd64.AppImage
   ```

2. **Put it where it will stay**, for example in a folder named `Applications` in your home folder. AncesTree starts itself from there whenever you sign in, so don't move it afterwards.
3. **Open it.** If nothing happens, run it from a terminal. If the terminal mentions FUSE, install it, then open AncesTree again.
   - On Ubuntu 24.04 or newer: `sudo apt install libfuse2t64`
   - On Ubuntu 22.04: `sudo apt install libfuse2`

## 2. The first start

The first time AncesTree starts, it fetches its database and the Java it runs on: about 330 MB, checked before it's used. The window says how far it has got. This happens only once.
<!-- picture: guide/first-start.png -->

After that, AncesTree starts in a few seconds.

**AncesTree keeps running by the clock.** Its icon is in the corner of the screen:

- on **Windows**, by the clock at the bottom right. If you can't see it, click the **^** arrow beside the clock;
- on a **Mac**, in the menu bar at the top right;
- on **Linux**, in the top bar or the panel, if your desktop shows such icons.

<!-- picture: guide/tray-menu.png -->

Closing the window doesn't stop AncesTree: it keeps the family in step while it runs. To open the window again, click the icon, or choose **Open AncesTree** in its menu. On a Mac you can also click AncesTree in the Dock. To stop AncesTree, choose **Quit AncesTree** in the icon's menu.

**AncesTree starts by itself** when you sign in to your computer, without opening its window. To stop that, untick **Start when I sign in** in the icon's menu.

## 3. For the keeper

### Your family, from the AncesTree you used before

If your family is already in another AncesTree, bring it across before you start the family folder:

1. **In the AncesTree you used before:** open **Settings → Backups** and choose **Back up now**. It says which folder it saved the backup in.
2. **In the new AncesTree:** open **Settings → Backups**, choose **Add a backup file…**, and choose that backup.
3. Choose **Restore…** beside it, then **Replace everything**.

### Start the family folder

1. **Open Settings → Family folder**, and choose **Sign in with Google**. Google's page opens in your web browser.
2. **Choose your Google account.** The family folder goes in its Google Drive.
3. **Google says "Google hasn't verified this app".** Google says this about any app it hasn't checked, and AncesTree is made for one family. Choose **Advanced**, then **Go to AncesTree (unsafe)**.
   <!-- picture: guide/google-1-not-verified.png, guide/google-2-advanced.png -->
4. **Google asks what AncesTree may do.** Tick both boxes, then choose **Continue**:
   - seeing your Google Drive's files, so that AncesTree can find the family folder;
   - changing only the files AncesTree itself makes.

   AncesTree only ever looks in the family folder.
   <!-- picture: guide/google-3-access.png -->
5. **The page says "Done. You can close this tab and go back to AncesTree."** Close the tab and go back to AncesTree.
6. Under **Start your family's folder, as its keeper**, type **the family's name**, such as *Keluarga Rahman*, and **this computer's name**, such as *Home PC*. Then choose **Start the family folder**.
   <!-- picture: guide/keeper-1-start.png -->
7. **AncesTree shows your recovery code.** With it, and this Google account, you can be the family's keeper again on another computer. Without it, no one can.
   - Choose **Print**, or write the code down. Keep it somewhere safe, away from this computer.
   - AncesTree shows the code only this once. Don't quit AncesTree until you've kept it.
   - When it's safe, choose **I've kept it safe**.
   <!-- picture: guide/keeper-2-recovery-code.png -->

Everything AncesTree puts in Google Drive is locked on your computer first. Google keeps the files, but can't read them.

### Invite a relative

1. Under **Invite a relative, by their Google account**, type their Google address and choose **Invite**.
   <!-- picture: guide/keeper-3-invite.png -->
2. **Tell them yourself**: Google doesn't send them anything. Send them this guide, and ask them to follow [For relatives](#4-for-relatives).

### Let their computer in

When a relative asks to join, their computer shows under **Asking to join**, with a code of eight letters and numbers.
<!-- picture: guide/keeper-4-asking-to-join.png -->

1. **Call or message them**, and ask them to read you the code on their screen.
2. **Let them in only if it's the same code.** If it isn't, choose **Not this one**.
3. **Choose what their computer may do:**
   - **Trusted**: their changes come in by themselves, unless they clash with yours or take something out;
   - **Contributor**: you look at each of their changes first;
   - **Viewer**: they receive the family, and change nothing.
4. Choose **Let in**.

The family arrives on their computer within a few minutes, photos and stories too.

### Changes waiting

When a relative changes something, it waits for you. **Settings**, the gear at the top right, shows a number when changes are waiting, or when a computer asks to join.

1. Open **Settings → Family folder**. Under **Changes waiting**, choose **Review**.
   <!-- picture: guide/keeper-5-changes-waiting.png -->
2. **Each change has a tick.** Untick what you don't want.
   - A change that clashes with one of yours, or that takes something out, waits for its own tick.
   - Under **To check**, AncesTree asks whether someone new is someone already in the family.
3. **Write a note if you like.** It goes back to them with whatever you don't take.
4. Choose **Bring in**, or **Take none**.
   <!-- picture: guide/keeper-6-review.png -->

Before anything comes in, AncesTree makes a backup. **Undo** takes back the people, details and links. **Settings → Import** keeps each bringing-in; its **Take back** undoes all of it, life stories and photos too. What you bring in reaches every computer in the family.

### Remove a computer

Under **The family's computers**, choose **Remove** beside it. AncesTree stops sharing the family folder with that account. That computer keeps what it already has, but can't read anything new.

### Copies to look at

For relatives on phones or tablets, or anyone who won't install AncesTree, choose **Export → View-only copy → Make a copy…**. It makes one file with the whole family inside, to send by message or email. It opens in any web browser, and nothing in it can be changed.

### The keeper on a new computer

1. Install AncesTree on the new computer.
2. Open **Settings → Family folder**, and sign in with the Google account that started the family folder.
3. Open **The family's keeper, on a new computer?**, type your recovery code, and choose **Be the keeper again**.

## 4. For relatives

Your family's keeper invites your Google account first. Install AncesTree (see [Install AncesTree](#1-install-ancestree)), then:

### Join your family

1. **AncesTree says "Welcome to AncesTree"** and asks whether your family keeps its AncesTree in a family folder. Choose **Join or start**. Or open **Settings → Family folder**.
   <!-- picture: guide/relative-1-welcome.png -->
2. **Choose Sign in with Google.** Google's page opens in your web browser. Choose the Google account your keeper invited.
3. **Google says "Google hasn't verified this app".** Google says this about any app it hasn't checked, and AncesTree is made for one family. Choose **Advanced**, then **Go to AncesTree (unsafe)**.
4. **Google asks what AncesTree may do.** Tick both boxes, then choose **Continue**. AncesTree only ever looks in your family's folder, and in the small folder it makes for what it sends your keeper.
5. **The page says "Done. You can close this tab and go back to AncesTree."** Close the tab and go back to AncesTree.
6. Under **Join your family's AncesTree**, type a name for this computer, such as *Aisyah's laptop*, and choose **Ask to join**.
   <!-- picture: guide/relative-2-join.png -->
7. **AncesTree shows a code.** Read it to your keeper, by phone or message.
   <!-- picture: guide/relative-3-code.png -->
8. **When your keeper lets you in, the family arrives by itself**, photos and stories too. Leave AncesTree running: with many photos, it can take a while.

If you had already put people into AncesTree yourself, the family replaces them on this computer. What you had is kept in a backup, under **Settings → Backups**. Send it to your keeper if it should join the family.

### Make changes

Your keeper chooses what your computer may do:

- **Contributor** or **Trusted**: add and change people, their links, life stories and photos, as you like. Your changes show on your computer straight away, and wait for your keeper. The bar at the top says how many are waiting. AncesTree sends them by itself; **Send now** sends them at once. Your keeper sees them the next time their AncesTree is running.
  <!-- picture: guide/relative-4-changes-waiting.png -->
- **Viewer**: you see the whole family, but can't change it on this computer.

Some things are your keeper's alone: the kinds of relationship, the map's pins, imports, and restoring a backup.

### Your keeper's answer

When your keeper brings your changes in, they reach every computer in the family, yours too. When your keeper leaves something out, or writes you a note, **Settings → Family folder** shows **The keeper's answer**: the note, and what wasn't taken. Choose **Got it** when you've read it.

## 5. Updates

AncesTree looks for a new version each time it starts, and once a day. When there is one, a bar says **A new version of AncesTree is ready**. Choose **Restart to update**, or carry on: it installs itself the next time AncesTree starts.
<!-- picture: guide/update-ready.png -->

To look for a new version yourself, choose **Check for updates** in the icon's menu, or in **Settings → About**.

## 6. Lock your computer's disk

The family folder in Google Drive is locked: only your family's computers can read it. On each computer, though, the family is kept as it is. Anyone who has the computer can read it, unless its disk is locked. Many new computers lock it already. To check, and to turn it on:

- **Windows 11 Home:** open **Start → Settings → Privacy & security → Device encryption**, and turn it **On**. If it isn't there, your computer can't do it.
- **Windows Pro:** open **Start**, type **Manage BitLocker**, open it, and choose **Turn on BitLocker**.
- **Mac:** open **System Settings → Privacy & Security → FileVault**, and choose **Turn On**.
- **Linux:** choose to encrypt the disk when you install Linux. Most kinds of Linux can't turn it on afterwards.

When you turn it on, you're given a recovery key. Keep it as safely as the family's recovery code: without it, a forgotten password loses everything on the computer.

Give your computer a password too, so that no one else can sign in to it.

## 7. Where AncesTree keeps the family

AncesTree keeps everything in one folder:

| Your computer | The folder |
|---|---|
| Windows | `%LOCALAPPDATA%\app.ancestree.desktop` |
| Mac | `~/Library/Application Support/app.ancestree.desktop` |
| Linux | `~/.local/share/app.ancestree.desktop` |

Inside it:

- `family`: the photos, life stories and settings;
- `backups`: AncesTree makes a backup each day while it runs, and keeps the last 30. Backups you make yourself are kept until you delete them;
- `logs`: what AncesTree did. If something goes wrong, your keeper may ask for this folder.

**Settings → About** shows where the folders are. To open the folder on Windows, paste its name into File Explorer's address bar. On a Mac, in Finder, choose **Go → Go to Folder…** and paste it.

## 8. When something goes wrong

| What you see | What to do |
|---|---|
| **AncesTree needs the internet this once, to fetch its database** | Connect to the internet. AncesTree tries again by itself. |
| **AncesTree's engine stopped**, or **Can't reach the database** | Choose **Quit AncesTree** in the icon's menu, then open AncesTree again. Nothing is lost: your family is safe on the disk. If it happens again, send your keeper the `logs` folder (see [Where AncesTree keeps the family](#7-where-ancestree-keeps-the-family)). |
| The window has gone | AncesTree is still running. Click its icon by the clock, or choose **Open AncesTree** in its menu. On a Mac, click AncesTree in the Dock. On Linux, open AncesTree again from your apps. |
| No icon by the clock on Linux | Your desktop doesn't show such icons. On GNOME, add the **AppIndicator** extension. Or open AncesTree from your apps, which brings back its window. |
| **No family folder is shared with this Google account yet** | Check that you signed in with the account your keeper invited. If you did, ask your keeper to invite it, then choose **look again**. |
| **Both boxes need ticking on Google's page** | Sign in again, and tick both boxes. |
| **The sign-in to Google has ended: sign in again** | Open **Settings → Family folder**, and choose **Sign in with Google**. |
| **No internet just now** | Nothing to do: AncesTree tries again every minute. |
| **Photos and stories are still arriving** | Leave AncesTree running: the family comes when they have. |
| **The family folder isn't shared with this Google account any more** | Ask your keeper. |
| **This computer was removed from the family** | Your keeper removed it. What's on it stays, but nothing new arrives. |
| **The family folder can't be found in your Google Drive** (the keeper) | If you deleted it, take it out of the trash in Google Drive. |

## 9. Removing AncesTree

**On Windows:** open **Start → Settings → Apps → Installed apps**, choose **…** beside AncesTree, then **Uninstall**. The uninstaller asks whether to **Delete the application data**:

- leave it unticked to keep the family and its backups on this computer, for when you install AncesTree again;
- tick it to remove them too.

<!-- picture: guide/windows-6-uninstall.png -->

The same box shows if you install a new version over an old one and choose to uninstall the old one first. Leave it unticked there.

**On a Mac:** untick **Start when I sign in** in AncesTree's menu, choose **Quit AncesTree**, and drag AncesTree from **Applications** to the Trash. The family stays in its folder (see [Where AncesTree keeps the family](#7-where-ancestree-keeps-the-family)) until you delete that too.

**On Linux:** untick **Start when I sign in**, choose **Quit AncesTree**, and delete the AppImage. The family stays in its folder until you delete that too.

If you're leaving the family, ask your keeper to remove your computer too.
