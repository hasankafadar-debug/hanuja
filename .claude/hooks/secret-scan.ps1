$raw = [Console]::In.ReadToEnd()
if ([string]::IsNullOrWhiteSpace($raw)) { exit 0 }

try {
    $payload = $raw | ConvertFrom-Json -Depth 50
} catch {
    exit 0
}

$filePath = [string]$payload.tool_input.file_path
$normalizedPath = ($filePath -replace "\\", "/").ToLowerInvariant()

if (
    $normalizedPath -match '(^|/)\.env($|[.])' -or
    $normalizedPath -match '(^|/)secrets/' -or
    $normalizedPath -match '(^|/)config/credentials/' -or
    $normalizedPath -match '(^|/)\.claude/settings\.local\.json$'
) {
    [Console]::Error.WriteLine("Blocked: sensitive files must not be edited through project hooks.")
    exit 2
}

$content = ""
if ($null -ne $payload.tool_input.content) {
    $content = [string]$payload.tool_input.content
} elseif ($null -ne $payload.tool_input.new_string) {
    $content = [string]$payload.tool_input.new_string
}

if ([string]::IsNullOrWhiteSpace($content)) { exit 0 }

$patterns = @(
    @{ Pattern = '-----BEGIN [A-Z ]*PRIVATE KEY-----'; Reason = 'private key material detected' },
    @{ Pattern = '\bAKIA[0-9A-Z]{16}\b'; Reason = 'AWS access key-like token detected' },
    @{ Pattern = '\bghp_[A-Za-z0-9]{20,}\b'; Reason = 'GitHub token-like value detected' },
    @{ Pattern = '\bsk_live_[A-Za-z0-9]+\b'; Reason = 'live secret key-like value detected' },
    @{ Pattern = '\bIYZICO(_|-)?(SECRET|API)(_|-)?KEY\b'; Reason = 'Iyzico secret identifier detected' },
    @{ Pattern = '(?i)\b(secret|api[_-]?key|private[_-]?key|client[_-]?secret)\b\s*[:=]\s*["''][^"'']{8,}["'']'; Reason = 'hardcoded secret-like assignment detected' }
)

foreach ($rule in $patterns) {
    if ($content -match $rule.Pattern) {
        [Console]::Error.WriteLine("Blocked: $($rule.Reason). Use .env.example or placeholder values instead.")
        exit 2
    }
}

exit 0