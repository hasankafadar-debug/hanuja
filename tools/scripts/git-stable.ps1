param(
  [Parameter(Position = 0)]
  [string]$Name,

  [Parameter(Position = 1)]
  [string]$Note = "Stable checkpoint"
)

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$tagName = if ([string]::IsNullOrWhiteSpace($Name)) { "stable-$timestamp" } else { $Name.Trim() }

$existingTag = git tag --list $tagName
if ($LASTEXITCODE -ne 0) {
  Write-Error "Git tag listesi okunamadi."
  exit 1
}

if (-not [string]::IsNullOrWhiteSpace($existingTag)) {
  Write-Error "Bu tag zaten var: $tagName"
  exit 1
}

git tag -a $tagName -m $Note
if ($LASTEXITCODE -ne 0) {
  Write-Error "Stable tag olusturulamadi."
  exit 1
}

$remotes = @("origin", "backup")

foreach ($remote in $remotes) {
  git remote get-url $remote *> $null
  if ($LASTEXITCODE -eq 0) {
    git push $remote $tagName
    if ($LASTEXITCODE -ne 0) {
      Write-Warning "$remote remote'una tag gonderilemedi: $tagName"
    }
  }
}

Write-Host "Stable tag hazir: $tagName"
