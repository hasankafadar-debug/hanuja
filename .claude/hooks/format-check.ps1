$raw = [Console]::In.ReadToEnd()
if ([string]::IsNullOrWhiteSpace($raw)) { exit 0 }

try {
    $payload = $raw | ConvertFrom-Json -Depth 50
} catch {
    exit 0
}

$filePath = $payload.tool_input.file_path
if ([string]::IsNullOrWhiteSpace($filePath)) { exit 0 }
if (-not (Test-Path $filePath)) { exit 0 }

$ext = [System.IO.Path]::GetExtension($filePath).ToLowerInvariant()
$supported = @(
    ".ts", ".tsx", ".js", ".jsx",
    ".json", ".md", ".css", ".scss",
    ".html", ".yml", ".yaml"
)

if ($supported -notcontains $ext) { exit 0 }

$projectDir = $env:CLAUDE_PROJECT_DIR
if ([string]::IsNullOrWhiteSpace($projectDir)) {
    $projectDir = Split-Path -Parent $filePath
}

$pnpm = Get-Command pnpm -ErrorAction SilentlyContinue
if (-not $pnpm) { exit 0 }

& pnpm --dir $projectDir exec prettier --version *> $null
if ($LASTEXITCODE -ne 0) { exit 0 }

& pnpm --dir $projectDir exec prettier --write --log-level warn -- "$filePath" *> $null
exit 0