# Starts everything for development: Neo4j (Docker), the API and the web app.
# Each server opens in its own window; close a window to stop that server.
#
#   powershell -ExecutionPolicy Bypass -File scripts\dev.ps1
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot

Write-Host 'Starting Neo4j (Docker)...'
docker compose --project-directory $root up -d --wait neo4j
if ($LASTEXITCODE -ne 0) { throw 'Neo4j did not start. Is Docker Desktop running?' }

Start-Process powershell -ArgumentList @('-NoExit', '-ExecutionPolicy', 'Bypass', '-File', (Join-Path $PSScriptRoot 'serve-backend.ps1'))
Start-Process powershell -ArgumentList @('-NoExit', '-Command', "Set-Location '$root\frontend'; pnpm dev")

Write-Host ''
Write-Host 'App:            http://127.0.0.1:5173'
Write-Host 'API docs:       http://127.0.0.1:8000/docs'
Write-Host 'Neo4j Browser:  http://127.0.0.1:7474  (user neo4j, password in .env)'
