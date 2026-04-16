$raw = [Console]::In.ReadToEnd()
if ([string]::IsNullOrWhiteSpace($raw)) { exit 0 }

try {
    $payload = $raw | ConvertFrom-Json -Depth 50
} catch {
    exit 0
}

$filePath = [string]$payload.tool_input.file_path
$normalizedPath = ($filePath -replace "\\", "/").ToLowerInvariant()

$financeRelevant =
    $normalizedPath -match '(^|/)api/' -or
    $normalizedPath -match '(^|/)db/' -or
    $normalizedPath -match '(^|/)apps/admin-panel/' -or
    $normalizedPath -match '(^|/)apps/seller-panel/' -or
    $normalizedPath -match '(^|/)\.claude/rules/07-marketplace-finance-rules\.md$' -or
    $normalizedPath -match '(^|/)\.claude/rules/08-order-lifecycle-rules\.md$' -or
    $normalizedPath -match '(^|/)\.claude/rules/09-seller-panel-rules\.md$' -or
    $normalizedPath -match '(^|/)\.claude/rules/10-admin-panel-rules\.md$'

if (-not $financeRelevant) { exit 0 }

$newContent = ""
if ($null -ne $payload.tool_input.content) {
    $newContent = [string]$payload.tool_input.content
} elseif ($null -ne $payload.tool_input.new_string) {
    $newContent = [string]$payload.tool_input.new_string
}

$oldContent = ""
if ($null -ne $payload.tool_input.old_string) {
    $oldContent = [string]$payload.tool_input.old_string
}

if ([string]::IsNullOrWhiteSpace($newContent)) { exit 0 }

$newLower = $newContent.ToLowerInvariant()
$oldLower = $oldContent.ToLowerInvariant()

# payout başlangıcı delivered'a bağlanamaz
if (
    $newLower -match 'payout' -and
    $newLower -match 'delivered' -and
    $newLower -notmatch 'delivery_confirmed'
) {
    [Console]::Error.WriteLine("Blocked: payout lifecycle cannot start from delivered. It must start from delivery_confirmed.")
    exit 2
}

# delivery_confirmed ile delivered birleştirilemez
if (
    $newLower -match 'delivery_confirmed\s*[:=]\s*["'']?delivered["'']?' -or
    $newLower -match 'delivered\s*[:=]\s*["'']?delivery_confirmed["'']?' -or
    $newLower -match 'deliveryconfirmed\s*[:=]\s*["'']?delivered["'']?'
) {
    [Console]::Error.WriteLine("Blocked: delivered and delivery_confirmed must stay separate.")
    exit 2
}

# eski metinden delivery_confirmed kaldırılıp delivered ile sadeleştirilirse durdur
if (
    $oldLower -match 'delivery_confirmed' -and
    $newLower -notmatch 'delivery_confirmed' -and
    $newLower -match 'delivered'
) {
    [Console]::Error.WriteLine("Blocked: delivery_confirmed was removed from a finance/lifecycle-sensitive change.")
    exit 2
}

# standart ceza %20'dir; yaygın yanlış oranları yakala
if (
    $newLower -match 'penalty(rate|_rate|percentage|_percentage)?\s*[:=]\s*(0\.1|0\.10|10|15|0\.15|25|0\.25)\b'
) {
    [Console]::Error.WriteLine("Blocked: standard penalty must remain 20% of product amount unless project rules are explicitly changed.")
    exit 2
}

exit 0