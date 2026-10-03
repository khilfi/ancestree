# PyInstaller recipe for the desktop app's engine: the app's pages and the copy's
# app go inside it. From backend/:
#
#   uv run --with pyinstaller pyinstaller ../desktop/engine/engine.spec --noconfirm \
#       --distpath ../desktop/engine/dist --workpath ../desktop/engine/build
#
# One folder, not one file: a single file unpacks itself on every start, which is slower
# and more often mistaken for malware by antivirus.

from pathlib import Path

from PyInstaller.utils.hooks import collect_data_files, collect_submodules

here = Path(SPECPATH)  # noqa: F821 (PyInstaller provides it)
pages = here.parents[1] / "frontend" / "dist"
viewer = here.parents[1] / "frontend" / "dist-viewer" / "viewer.html"
if not (pages / "index.html").is_file():
    raise SystemExit("Build the frontend first: pnpm build, in frontend/")
if not viewer.is_file():
    raise SystemExit("Build the copy's app first: pnpm build:viewer, in frontend/")

# No Google client goes in, even one left in the package while developing: each family signs
# in through its keeper's own Google project.
package = [
    (source, target)
    for source, target in collect_data_files("ancestree")
    if Path(source).name != "google-client.json"
]

analysis = Analysis(  # noqa: F821
    [str(here / "engine.py")],
    pathex=[str(here)],
    datas=[*package, (str(pages), "pages"), (str(viewer), "viewer")],
    hiddenimports=[*collect_submodules("ancestree"), *collect_submodules("uvicorn")],
    excludes=["tkinter", "pytest", "hypothesis", "IPython"],
)
program = EXE(  # noqa: F821
    PYZ(analysis.pure),  # noqa: F821
    analysis.scripts,
    [],
    exclude_binaries=True,
    name="ancestree-engine",
    console=True,  # the shell starts it with no window, and reads its output
    upx=False,
)
COLLECT(program, analysis.binaries, analysis.datas, name="ancestree-engine", upx=False)  # noqa: F821
