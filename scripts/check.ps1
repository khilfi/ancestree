# Runs every automated check and stops at the first failure.
#
#   powershell -ExecutionPolicy Bypass -File scripts\check.ps1          everything
#   powershell -ExecutionPolicy Bypass -File scripts\check.ps1 -Quick   skip the Docker-based tests
param([switch]$Quick)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$env:Path = "$env:USERPROFILE\.local\bin;$env:Path"

function Invoke-Step([string]$Name, [scriptblock]$Command) {
    Write-Host "`n== $Name" -ForegroundColor Cyan
    & $Command
    if ($LASTEXITCODE -ne 0) { throw "FAILED: $Name" }
}

function Get-Fingerprint([string[]]$Paths) {
    ($Paths | ForEach-Object {
        if (Test-Path $_) { (Get-FileHash $_ -Algorithm SHA256).Hash } else { 'missing' }
    }) -join ','
}

$generated = @("$root\frontend\openapi.json", "$root\frontend\src\api\schema.d.ts")
$before = Get-Fingerprint $generated

Push-Location "$root\backend"
try {
    Invoke-Step 'backend: lint (ruff)' { uv run ruff check . }
    Invoke-Step 'backend: formatting (ruff)' { uv run ruff format --check . }
    Invoke-Step 'backend: types (mypy, strict)' { uv run mypy }
    if ($Quick) {
        Invoke-Step 'backend: unit tests' { uv run pytest -m 'not integration' -q }
    } else {
        Invoke-Step 'backend: all tests (starts a throwaway Neo4j)' { uv run pytest -q }
    }
    Invoke-Step 'desktop: lint and formatting (ruff)' { uv run ruff check ../desktop; if ($LASTEXITCODE -eq 0) { uv run ruff format --check ../desktop } }
    $desktop = @('../desktop/engine', '../desktop/tools' | Where-Object { Test-Path $_ })  # the tools aren't published
    Invoke-Step 'desktop: types (mypy, strict)' { $env:MYPYPATH = 'src'; uv run mypy @desktop; Remove-Item Env:MYPYPATH }
    Invoke-Step 'desktop: the engine and its tools (tests)' { uv run pytest -q -p no:cacheprovider @desktop }
    Invoke-Step 'api: export schema' { uv run ancestree openapi --out ../frontend/openapi.json }
} finally { Pop-Location }

Push-Location "$root\frontend"
try {
    Invoke-Step 'frontend: generate API types' { pnpm run gen:api }
    Invoke-Step 'frontend: lint and formatting (biome)' { pnpm run lint }
    Invoke-Step 'frontend: types (tsc)' { pnpm run typecheck }
    Invoke-Step 'frontend: tests (vitest)' { pnpm run test }
    Invoke-Step 'frontend: production build' { pnpm exec vite build }
    Invoke-Step "frontend: the view-only copy's app" { pnpm exec vite build --mode viewer }
} finally { Pop-Location }

if ((Get-Fingerprint $generated) -ne $before) {
    Write-Host "`nThe API changed: frontend/openapi.json and src/api/schema.d.ts were regenerated. Commit them with your change." -ForegroundColor Yellow
}
Write-Host "`nAll checks passed." -ForegroundColor Green
