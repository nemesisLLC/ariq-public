param(
  [ValidateSet('wonder','gpt')][string]$Engine = 'wonder',
  [Parameter(Mandatory=$true)][string]$PromptFile,
  [string]$OutputFile,
  [ValidateRange(1,15)][int]$MaxMinutes = 12,
  [ValidateRange(1,40)][int]$MaxTools = 30
)
$ErrorActionPreference = 'Stop'
$repoPath = Split-Path $PSScriptRoot -Parent
if (-not (Test-Path -LiteralPath $PromptFile)) { throw 'Task prompt is missing.' }
$resolvedPrompt = (Resolve-Path -LiteralPath $PromptFile).Path
$previousKey = $env:MODEL_API_KEY
$codexArgs = @('--no-daemon','exec','--ephemeral','--json')
if ($Engine -eq 'wonder') {
  # Credentials stay in this process and are excluded from agent shell tools.
  if ([string]::IsNullOrWhiteSpace($env:MODEL_API_KEY)) {
    $credentialPath = Join-Path $env:USERPROFILE '.config\muse\auth.json'
    if (-not (Test-Path -LiteralPath $credentialPath)) { throw 'Meta sign-in is required.' }
    $credential = Get-Content -Raw -LiteralPath $credentialPath | ConvertFrom-Json
    $env:MODEL_API_KEY = $credential.providers.meta.api_key
    $credential = $null
  }
  if ([string]::IsNullOrWhiteSpace($env:MODEL_API_KEY)) { throw 'No Meta API key is available.' }
  $codexArgs += @('--ignore-user-config','--profile','ariq-wonder')
}
$codexArgs += @('--cd',$repoPath,'-')
if ($OutputFile) { $codexArgs = $codexArgs[0..($codexArgs.Count-2)] + @('--output-last-message',$OutputFile,'-') }
Push-Location -LiteralPath $repoPath
try {
  # The engine is explicit: a quota failure never silently changes billing providers.
  $codexBinary = (Get-Command codex -ErrorAction Stop).Source
  & node (Join-Path $PSScriptRoot 'run-builder.cjs') $codexBinary $resolvedPrompt $MaxMinutes $MaxTools @codexArgs
  if ($LASTEXITCODE -ne 0) { throw 'Builder stopped. Inspect its result before continuing with either engine.' }
} finally {
  $env:MODEL_API_KEY = $previousKey
  Pop-Location
}
