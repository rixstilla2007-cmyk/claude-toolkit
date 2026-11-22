# server.ps1 - read-only local server for the agent office (Windows).
# Double-click start-office.cmd, or run:
#   powershell -NoProfile -ExecutionPolicy Bypass -File office\server.ps1
# It only reads Claude Code transcripts under %USERPROFILE%\.claude\projects
# and answers only to this computer. Twin of server.mjs (same API).
# Saved as UTF-8 with BOM so Windows PowerShell 5.1 reads the Russian text right.
param(
    [int]$Port = 4545,
    [string]$Root = '',
    [string]$Dir = $PSScriptRoot,
    [switch]$NoBrowser
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Web

if (-not $Root) {
    $cfg = $env:CLAUDE_CONFIG_DIR
    if (-not $cfg) { $cfg = Join-Path $HOME '.claude' }
    $Root = Join-Path $cfg 'projects'
}
$Root = [System.IO.Path]::GetFullPath($Root)
$Sep = [System.IO.Path]::DirectorySeparatorChar
$Max = 4MB
$Utf8 = New-Object System.Text.UTF8Encoding($false)

function Send($ctx, [int]$status, $body, [string]$type = 'application/json; charset=utf-8') {
    if ($body -is [byte[]]) { $bytes = $body } else { $bytes = $Utf8.GetBytes([string]$body) }
    $res = $ctx.Response
    $res.StatusCode = $status
    $res.ContentType = $type
    $res.Headers['Cache-Control'] = 'no-store'
    $res.ContentLength64 = $bytes.Length
    $res.OutputStream.Write($bytes, 0, $bytes.Length)
    $res.OutputStream.Close()
}

function Get-Sessions {
    $mains = @()
    if (Test-Path -LiteralPath $Root -PathType Container) {
        foreach ($p in Get-ChildItem -LiteralPath $Root -Directory -ErrorAction SilentlyContinue) {
            foreach ($f in Get-ChildItem -LiteralPath $p.FullName -File -Filter '*.jsonl' -ErrorAction SilentlyContinue) {
                if (-not $f.Name.EndsWith('.jsonl')) { continue }
                $mains += [pscustomobject]@{
                    file = "$($p.Name)/$($f.Name)"; project = $p.Name; size = $f.Length
                    mtime = (New-Object DateTimeOffset($f.LastWriteTimeUtc)).ToUnixTimeMilliseconds()
                }
            }
        }
    }
    $out = @()
    foreach ($m in @($mains | Sort-Object mtime -Descending | Select-Object -First 20)) {
        $rel = $m.file.Substring(0, $m.file.Length - 6) + '/subagents'
        $subDir = Join-Path $Root ($rel -replace '/', $Sep)
        $subs = @()
        if (Test-Path -LiteralPath $subDir -PathType Container) {
            foreach ($s in Get-ChildItem -LiteralPath $subDir -File -Filter 'agent-*.jsonl' -ErrorAction SilentlyContinue) {
                if ($s.Name.EndsWith('.jsonl')) { $subs += [ordered]@{ file = "$rel/$($s.Name)"; size = $s.Length } }
            }
        }
        $out += [ordered]@{ file = $m.file; project = $m.project; mtime = $m.mtime; size = $m.size; subs = $subs }
    }
    return ,$out
}

# Only a relative *.jsonl path inside $Root; anything else is refused.
function Resolve-Safe([string]$file) {
    if (-not $file -or -not $file.EndsWith('.jsonl')) { return $null }
    if ([System.IO.Path]::IsPathRooted($file) -or $file -match '^[a-zA-Z]:') { return $null }
    $parts = $file -split '[\\/]'
    if ($parts -contains '..') { return $null }
    $full = [System.IO.Path]::GetFullPath((Join-Path $Root ($parts -join $Sep)))
    $top = $Root.TrimEnd($Sep) + $Sep
    if (-not $full.StartsWith($top, [System.StringComparison]::OrdinalIgnoreCase)) { return $null }
    return $full
}

function Read-From([string]$full, [long]$from) {
    $share = [System.IO.FileShare]::ReadWrite -bor [System.IO.FileShare]::Delete
    $fs = [System.IO.File]::Open($full, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, $share)
    try {
        $size = $fs.Length
        if ($from -lt 0) { $from = 0 }
        if ($from -gt $size) { $from = $size }
        $len = [int][Math]::Min([long]$Max, $size - $from)
        $buf = New-Object byte[] $len
        $fs.Position = $from
        $got = 0
        while ($got -lt $len) {
            $n = $fs.Read($buf, $got, $len - $got)
            if ($n -le 0) { break }
            $got += $n
        }
        $keep = 0
        if ($got -gt 0) {
            $nl = [Array]::LastIndexOf($buf, [byte]10, $got - 1)
            # A single line longer than 4 MB is skipped instead of blocking the reader forever.
            if ($nl -ge 0) { $keep = $nl + 1 } elseif ($got -eq $Max) { $keep = $got }
        }
        $text = [System.Web.HttpUtility]::JavaScriptStringEncode($Utf8.GetString($buf, 0, $keep), $true)
        return '{"text":' + $text + ',"next":' + ($from + $keep) + '}'
    } finally {
        $fs.Close()
    }
}

function Start-Listener([int]$p) {
    # Without admin rights Windows allows only the localhost prefix; try both first.
    foreach ($prefixes in @(@("http://127.0.0.1:$p/", "http://localhost:$p/"), @("http://localhost:$p/"))) {
        $l = New-Object System.Net.HttpListener
        foreach ($x in $prefixes) { $l.Prefixes.Add($x) }
        try { $l.Start(); return $l } catch { $l.Close() }
    }
    return $null
}

$listener = $null
for ($p = $Port; $p -le $Port + 10; $p++) {
    $listener = Start-Listener $p
    if ($listener) { $Port = $p; break }
}
if (-not $listener) { throw "Ports $Port-$($Port + 10) are busy." }

$url = "http://localhost:$Port/"
$hosts = @("127.0.0.1:$Port", "localhost:$Port")
Write-Host "Офис: $url"
Write-Host "Читаю журналы из $Root"
Write-Host 'Не закрывай это окно, пока смотришь офис. Остановить: закрой окно или нажми Ctrl+C.'
if (-not $NoBrowser) { Start-Process $url }

try {
    while ($listener.IsListening) {
        $ctx = $listener.GetContext()
        try {
            $req = $ctx.Request
            if ($hosts -notcontains $req.Headers['Host']) { Send $ctx 403 '{"error":"host"}'; continue }
            if ($req.HttpMethod -ne 'GET') { Send $ctx 405 '{"error":"method"}'; continue }
            $path = $req.Url.AbsolutePath
            if ($path -eq '/' -or $path -eq '/feed.js') {
                if ($path -eq '/') { $name = 'index.html'; $type = 'text/html; charset=utf-8' }
                else { $name = 'feed.js'; $type = 'text/javascript; charset=utf-8' }
                $file = Join-Path $Dir $name
                if (Test-Path -LiteralPath $file -PathType Leaf) { Send $ctx 200 ([System.IO.File]::ReadAllBytes($file)) $type }
                else { Send $ctx 404 '{"error":"not found"}' }
            } elseif ($path -eq '/api/sessions') {
                Send $ctx 200 (ConvertTo-Json -InputObject (Get-Sessions) -Compress -Depth 5)
            } elseif ($path -eq '/api/read') {
                $query = [System.Web.HttpUtility]::ParseQueryString($req.Url.Query)
                $full = Resolve-Safe $query['file']
                if (-not $full) { Send $ctx 400 '{"error":"file"}' }
                elseif (-not (Test-Path -LiteralPath $full -PathType Leaf)) { Send $ctx 404 '{"error":"missing"}' }
                else {
                    $from = [long]0
                    [void][long]::TryParse([string]$query['from'], [ref]$from)
                    Send $ctx 200 (Read-From $full $from)
                }
            } else {
                Send $ctx 404 '{"error":"not found"}'
            }
        } catch {
            try { Send $ctx 500 (ConvertTo-Json -InputObject @{ error = $_.Exception.Message } -Compress) } catch { }
        }
    }
} finally {
    $listener.Close()
}
