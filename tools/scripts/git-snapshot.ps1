param(
  [Parameter(Position = 0)]
  [string]$Message
)

$status = git status --porcelain
if ($LASTEXITCODE -ne 0) {
  Write-Error "Git durumu okunamadi."
  exit 1
}

if ([string]::IsNullOrWhiteSpace($status)) {
  Write-Host "Kaydedilecek degisiklik yok."
  exit 0
}

$commitMessage = if ([string]::IsNullOrWhiteSpace($Message)) {
  "snapshot: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
} else {
  $Message.Trim()
}

git add -A
if ($LASTEXITCODE -ne 0) {
  Write-Error "Degisiklikler stage edilemedi."
  exit 1
}

git commit -m $commitMessage
if ($LASTEXITCODE -ne 0) {
  Write-Error "Commit olusturulamadi."
  exit 1
}

$branchName = git branch --show-current
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($branchName)) {
  Write-Warning "Commit atildi ama branch adi okunamadi; push atlandi."
  exit 0
}

$remotes = @("origin", "backup")

foreach ($remote in $remotes) {
  git remote get-url $remote *> $null
  if ($LASTEXITCODE -eq 0) {
    git push $remote $branchName --follow-tags
    if ($LASTEXITCODE -ne 0) {
      Write-Warning "$remote remote'una push atilamadi: $branchName"
    }
  }
}

Write-Host "Snapshot commit ve push tamamlandi: $commitMessage"
