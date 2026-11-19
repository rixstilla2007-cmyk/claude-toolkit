# setup-windows.ps1 - set up Claude Code with this toolkit on a Windows computer.
#
# One command, in PowerShell (not as administrator):
#   irm https://raw.githubusercontent.com/rixstilla2007-cmyk/claude-toolkit/main/setup-windows.ps1 | iex
#
# What it does, skipping what is already there:
#   1. installs Git for Windows with winget (Claude Code needs it)
#   2. installs Claude Code with the official installer from claude.ai
#   3. clones this toolkit to %USERPROFILE%\claude-toolkit (or updates it)
#   4. copies the toolkit's agents and skills into %USERPROFILE%\.claude
#   5. creates the work folder %USERPROFILE%\claude-work
# It changes nothing else and never needs administrator rights itself
# (winget may show its own prompt for Git).

& {
$ErrorActionPreference = 'Stop'
$repo = 'https://github.com/rixstilla2007-cmyk/claude-toolkit'
$toolkit = Join-Path $HOME 'claude-toolkit'
$work = Join-Path $HOME 'claude-work'

function Step([string]$text) { Write-Host "`n==> $text" -ForegroundColor Cyan }

function Update-PathFromRegistry {
    # Pick up PATH changes made by installers in this same window.
    $machine = [Environment]::GetEnvironmentVariable('Path', 'Machine')
    $user = [Environment]::GetEnvironmentVariable('Path', 'User')
    $parts = @($env:Path, $machine, $user, (Join-Path $HOME '.local\bin')) -join ';' -split ';'
    $env:Path = ($parts | Where-Object { $_ } | Select-Object -Unique) -join ';'
}

function Have([string]$cmd) { [bool](Get-Command $cmd -ErrorAction SilentlyContinue) }

Step 'Git for Windows'
if (Have 'git') {
    Write-Host "already installed: $(git --version)"
} else {
    if (-not (Have 'winget')) {
        throw 'winget is missing. Install Git by hand from https://git-scm.com/download/win and run this again.'
    }
    winget install --id Git.Git -e --source winget --accept-source-agreements --accept-package-agreements
    Update-PathFromRegistry
    if (-not (Have 'git')) { throw 'Git was installed but is not on PATH yet. Open a new PowerShell window and run this again.' }
    Write-Host "installed: $(git --version)"
}

Step 'Claude Code'
if (Have 'claude') {
    Write-Host 'already installed'
} else {
    Invoke-RestMethod 'https://claude.ai/install.ps1' | Invoke-Expression
    Update-PathFromRegistry
    if (-not (Have 'claude')) { throw 'Claude Code was installed but is not on PATH yet. Open a new PowerShell window and run this again.' }
    Write-Host 'installed'
}

Step "Toolkit in $toolkit"
if (Test-Path (Join-Path $toolkit '.git')) {
    git -C $toolkit pull --ff-only
    if ($LASTEXITCODE -ne 0) { throw "git pull failed in $toolkit" }
} elseif (Test-Path $toolkit) {
    throw "$toolkit exists but is not a git clone. Rename or remove it and run this again."
} else {
    git clone $repo $toolkit
    if ($LASTEXITCODE -ne 0) { throw "git clone of $repo failed" }
}

Step 'Agents and skills into ~/.claude'
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $toolkit 'install.ps1')
if ($LASTEXITCODE -ne 0) { throw "install.ps1 failed with exit code $LASTEXITCODE" }

Step "Work folder $work"
New-Item -ItemType Directory -Force -Path $work | Out-Null
Write-Host 'ready'

Write-Host "`nDone. To start working with Claude on this computer:" -ForegroundColor Green
Write-Host "  cd `"$work`""
Write-Host '  claude'
Write-Host 'Sign in with your Claude account the first time.'
Write-Host 'To get toolkit updates later: run this same command again.'
}
