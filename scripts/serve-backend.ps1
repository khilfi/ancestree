# Runs the AncesTree API on http://127.0.0.1:8000 and restarts it when the code changes.
# `python -m ancestree` (not the ancestree.exe launcher) keeps uv free to update packages meanwhile.
$ErrorActionPreference = 'Stop'
$env:Path = "$env:USERPROFILE\.local\bin;$env:Path"
Set-Location (Join-Path $PSScriptRoot '..\backend')
uv run python -m ancestree serve --reload
