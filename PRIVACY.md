# AncesTree's privacy policy

AncesTree is a family-history app that runs on your own computer. This page says what it does with your family's data, and with your Google account if your family keeps its AncesTree in step through Google Drive. It's the same for every family that uses AncesTree.

## On your computer

Your family (its people, links, life stories and photos) is kept on your computer, in AncesTree's own database and data folder. AncesTree has no servers: nothing about your family is sent to its maintainer, or to anyone else. It has no advertising and no tracking. A computer that keeps several families keeps each apart, with a database and folders of its own.

If you choose to keep copies of your backups in a second place, such as a USB stick or a folder a cloud service keeps, they go where you choose, and can be locked with a password that AncesTree keeps nowhere.

On its own, it asks the internet for two things: whether there's a new version of AncesTree, from this repository; and, the first time it starts, for its database (Neo4j and Java). Neither carries anything about your family.

## The family folder, through Google Drive

A family can keep its AncesTree in step on several computers through a private folder in the keeper's Google Drive. Each family reaches Google through **its own Google project**, which its keeper sets up and owns: the name you see on Google's page when you sign in is the one your keeper gave it. AncesTree's maintainer has no part in any family's project, and sees nothing of what goes through it. The keeper's invitation, which relatives paste into AncesTree to join, carries that project's sign-in details and the family's id, and nothing of the family.

If you use it, you sign in to Google from AncesTree, and Google asks you to allow two things:

- **See and download all your Google Drive files** (`drive.readonly`). AncesTree reads only the family folder, and the small folders each relative's AncesTree keeps for sending its changes to the keeper. It doesn't look at anything else in your Drive.
- **See, edit, create and delete only the specific Google Drive files you use with this app** (`drive.file`). AncesTree changes only the files it makes itself.

Everything AncesTree puts in Google Drive is encrypted on your computer first, with the family's own keys, which only the family's computers can unlock. Google keeps the files, but can't read them, and no file or folder name says anything about your family.

Your Google sign-in is kept on your computer, protected for your Windows user (on macOS and Linux, in a file only you may read). AncesTree uses it only to reach the family's folders, and never sends your Google data to its maintainer, to your family's keeper, or to anyone else.

AncesTree's use and transfer of information received from Google APIs adheres to the [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy), including the Limited Use requirements.

You can sign out in AncesTree, in **Settings → Family folder**, at any time, and remove AncesTree's access from your Google account at [myaccount.google.com/permissions](https://myaccount.google.com/permissions).

## Questions

Ask in this repository's issues: [github.com/khilfi/ancestree/issues](https://github.com/khilfi/ancestree/issues).
