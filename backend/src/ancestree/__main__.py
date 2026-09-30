"""`python -m ancestree`: the same command line as the `ancestree` launcher.

Development scripts use this form so a running server never holds ancestree.exe open,
which on Windows would block `uv` from reinstalling the project.
"""

from ancestree.cli import app

app()
