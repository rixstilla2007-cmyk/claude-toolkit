# install.ps1 - copy this toolkit's agents, skills and hooks into ~/.claude on Windows
# (existing files of the same name are backed up as *.bak first), then wire the
# hooks, settings and CLAUDE.md rules with scripts\install_user.py (needs Python 3.10+).
#
# Run from the toolkit folder in PowerShell 5.1 or 7:
#   powershell -ExecutionPolicy Bypass -File .\install.ps1
# Set CLAUDE_HOME to install somewhere other than %USERPROFILE%\.claude.

$ErrorActionPreference = 'Stop'

$here = $PSScriptRoot
$dest = if ($env:CLAUDE_HOME) { $env:CLAUDE_HOME } else { Join-Path $HOME '.claude' }

function Test-SameContent([string]$a, [string]$b) {
    # True when $a and $b hold the same files with the same bytes.
    $hashes = {
        param($root)
        $item = Get-Item -LiteralPath $root
        if (-not $item.PSIsContainer) {
            return @("|" + (Get-FileHash -LiteralPath $root -Algorithm SHA256).Hash)
        }
        $base = $item.FullName.TrimEnd('\', '/')
        Get-ChildItem -LiteralPath $root -Recurse -File -Force | Sort-Object FullName | ForEach-Object {
            $_.FullName.Substring($base.Length) + "|" + (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash
        }
    }
    $left = @(& $hashes $a)
    $right = @(& $hashes $b)
    return (($left -join "`n") -eq ($right -join "`n"))
}

function Copy-Entry([string]$src, [string]$dst) {
    if ((Test-Path -LiteralPath $dst) -and -not (Test-SameContent $src $dst)) {
        $bak = "$dst.bak"
        if (Test-Path -LiteralPath $bak) { Remove-Item -LiteralPath $bak -Recurse -Force }
        Move-Item -LiteralPath $dst -Destination $bak
        Write-Host "backed up $dst -> $bak"
    }
    $parent = Split-Path -Parent $dst
    New-Item -ItemType Directory -Force -Path $parent | Out-Null
    if (Test-Path -LiteralPath $dst) { Remove-Item -LiteralPath $dst -Recurse -Force }
    Copy-Item -LiteralPath $src -Destination $dst -Recurse
    Write-Host "installed $dst"
}

Get-ChildItem -LiteralPath (Join-Path $here '.claude\agents') -Filter '*.md' -File | ForEach-Object {
    Copy-Entry $_.FullName (Join-Path $dest "agents\$($_.Name)")
}
Get-ChildItem -LiteralPath (Join-Path $here '.claude\skills') -Directory | ForEach-Object {
    Copy-Entry $_.FullName (Join-Path $dest "skills\$($_.Name)")
}
Get-ChildItem -LiteralPath (Join-Path $here '.claude\hooks') -Filter '*.py' -File | ForEach-Object {
    Copy-Entry $_.FullName (Join-Path $dest "hooks\$($_.Name)")
}

function Find-Python {
    # Full path of a real Python 3.10+, or $null. The Microsoft Store stub fails this check.
    $ErrorActionPreference = 'Continue'
    $check = 'import sys; print(sys.executable) if sys.version_info >= (3, 10) else sys.exit(1)'
    if (Get-Command py -ErrorAction SilentlyContinue) {
        $out = & py -3 -c $check 2>$null
        if ($LASTEXITCODE -eq 0 -and $out -and (Test-Path -LiteralPath "$out".Trim())) { return "$out".Trim() }
    }
    if (Get-Command python -ErrorAction SilentlyContinue) {
        $out = & python -c $check 2>$null
        if ($LASTEXITCODE -eq 0 -and $out -and (Test-Path -LiteralPath "$out".Trim())) { return "$out".Trim() }
    }
    return $null
}

$py = Find-Python
if ($py) {
    & $py (Join-Path $here 'scripts\install_user.py') --dest $dest
    if ($LASTEXITCODE -ne 0) { throw "install_user.py failed with exit code $LASTEXITCODE" }
} else {
    Write-Warning 'Python 3.10+ not found: hooks copied but not wired; settings.json and CLAUDE.md left as they are. Install Python (python.org) and run this again.'
}
Write-Host "done: restart Claude Code (or start a new session) to pick up new agents"
