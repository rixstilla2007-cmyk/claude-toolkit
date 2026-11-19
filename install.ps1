# install.ps1 - copy this toolkit's agents and skills into ~/.claude on Windows
# (existing files of the same name are backed up as *.bak first).
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
Write-Host "done: restart Claude Code (or start a new session) to pick up new agents"
