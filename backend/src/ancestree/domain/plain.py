"""Why something failed, said for the family: a computer's own error in plain words,
never its number, a file's path or Python's words, which say nothing to them. Whoever says it
logs the error itself, for engine.log."""

import errno

# The computer's own troubles that a family can do something about, as they'd say them.
_SAID = {
    errno.ENOSPC: "the disk is full",
    errno.EACCES: "this computer didn't let AncesTree at a file it needs",
    errno.EPERM: "this computer didn't let AncesTree at a file it needs",
    errno.EROFS: "the disk can't be written to",
    errno.ENOENT: "a file it needs isn't there any more",
}
_IN_USE = 32  # Windows: another program has the file open


def plainly(error: BaseException) -> str:
    """Why, in a few words: AncesTree's own errors as they say it, which are sentences
    already; a computer's own by what it means; anything else as unexpected."""
    if type(error).__module__.startswith("ancestree."):
        return str(error)
    if isinstance(error, OSError):
        if getattr(error, "winerror", None) == _IN_USE:
            return "another program has a file it needs open"
        if error.errno in _SAID:
            return _SAID[error.errno]
        return "this computer couldn't read or write a file it needs"
    return "something unexpected went wrong"
