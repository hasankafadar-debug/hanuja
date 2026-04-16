$raw = [Console]::In.ReadToEnd()
if ([string]::IsNullOrWhiteSpace($raw)) { exit 0 }

try {
    $payload = $raw | ConvertFrom-Json -Depth 50
} catch {
    exit 0
}

$filePath = [string]$payload.tool_input.file_path
$normalizedPath = ($filePath -replace "\\", "/").ToLowerInvariant()

$seoRelevant =
    $normalizedPath -match '(^|/)apps/web/' -or
    $normalizedPath -match '(^|/)packages/seo/' -or
    $normalizedPath -match '(^|/)docs/04-seo/' -or
    $normalizedPath -match '(^|/)\.claude/rules/04-seo-rules\.md$'

if (-not $seoRelevant) { exit 0 }

$content = ""
if ($null -ne $payload.tool_input.content) {
    $content = [string]$payload.tool_input.content
} elseif ($null -ne $payload.tool_input.new_string) {
    $content = [string]$payload.tool_input.new_string
}

if ([string]::IsNullOrWhiteSpace($content)) { exit 0 }

$forbiddenPublicFamilies = @(
    "/category/",
    "/product/",
    "/store/",
    "/article/",
    "/articles/",
    "/posts/"
)

foreach ($family in $forbiddenPublicFamilies) {
    if ($content -match [regex]::Escape($family)) {
        [Console]::Error.WriteLine("Blocked: forbidden public SEO route family detected: $family. Use only /kategori/, /urun/, /blog/, /magaza/.")
        exit 2
    }
}

exit 0