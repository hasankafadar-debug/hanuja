$raw = [Console]::In.ReadToEnd()
if ([string]::IsNullOrWhiteSpace($raw)) { exit 0 }

try {
    $payload = $raw | ConvertFrom-Json -Depth 50
} catch {
    exit 0
}

$filePath = [string]$payload.tool_input.file_path
$normalizedPath = ($filePath -replace "\\", "/").ToLowerInvariant()

# App Router içinde İngilizce SEO aileleri oluşturulmasını engelle
$forbiddenRouteFolders = @(
    "/apps/web/app/category/",
    "/apps/web/app/product/",
    "/apps/web/app/store/",
    "/apps/web/app/article/",
    "/apps/web/app/articles/",
    "/apps/web/app/posts/"
)

foreach ($folder in $forbiddenRouteFolders) {
    if ($normalizedPath.Contains($folder)) {
        [Console]::Error.WriteLine("Blocked: route path violates approved SEO route family policy: $folder")
        exit 2
    }
}

# SEO docs/helper içinde yanlış aile adlarını da durdur
$content = ""
if ($null -ne $payload.tool_input.content) {
    $content = [string]$payload.tool_input.content
} elseif ($null -ne $payload.tool_input.new_string) {
    $content = [string]$payload.tool_input.new_string
}

if (-not [string]::IsNullOrWhiteSpace($content)) {
    if (
        $content -match '(?i)\b(category|product|store)\b' -and
        (
            $normalizedPath -match '(^|/)packages/seo/' -or
            $normalizedPath -match '(^|/)docs/04-seo/' -or
            $normalizedPath -match '(^|/)apps/web/app/'
        )
    ) {
        [Console]::Error.WriteLine("Blocked: SEO/public route naming must use kategori, urun, blog, magaza families instead of English family names.")
        exit 2
    }
}

exit 0