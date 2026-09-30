"""The family folder.

A folder that invited relatives share, in Google Drive or any folder kept in step between
computers, through which their apps keep the family in step:

- the keeper publishes the family's record: change sets one after another, each naming the
  one before it, and now and then a snapshot of the whole family;
- every other computer sends its changes to the keeper, in a folder of its own;
- everything is encrypted with the family's key and signed by the computer that wrote it,
  and a file that doesn't check out is never used.

Each computer writes only files of its own, each once and never again, so a sync service
never has two versions of one file to choose between. File names are numbers and
fingerprints, so they say nothing about the family.
"""
