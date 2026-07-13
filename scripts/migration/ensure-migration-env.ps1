# Sets Supabase migration env vars in the CURRENT shell process only.
# Does not write secrets to disk. Do not commit output.
param()

$ErrorActionPreference = 'Stop'
$root = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$envFile = Join-Path $root '.env.local'

# Reuse Supabase CLI Windows CA bundle for Node fetch (same as scripts/supabase-cli.ps1)
$certPath = Join-Path $env:TEMP 'supabase-windows-cacerts.pem'
if (-not (Test-Path $certPath)) {
  $roots = Get-ChildItem Cert:\LocalMachine\Root, Cert:\CurrentUser\Root -ErrorAction SilentlyContinue |
    Sort-Object Thumbprint -Unique
  $sb = New-Object System.Text.StringBuilder
  foreach ($c in $roots) {
    if ($c.HasPrivateKey) { continue }
    $pem = "-----BEGIN CERTIFICATE-----`n" + [Convert]::ToBase64String($c.RawData, [Base64FormattingOptions]::InsertLineBreaks) + "`n-----END CERTIFICATE-----`n"
    [void]$sb.AppendLine($pem)
  }
  Set-Content -Path $certPath -Value $sb.ToString() -Encoding ascii
}
$env:SSL_CERT_FILE = $certPath
$env:NODE_EXTRA_CA_CERTS = $certPath

if (Test-Path $envFile) {
  Get-Content $envFile | ForEach-Object {
    if ($_ -match '^SUPABASE_ACCESS_TOKEN=(.+)$') {
      $env:SUPABASE_ACCESS_TOKEN = $Matches[1].Trim()
    }
    if ($_ -match '^VITE_SUPABASE_URL=(.+)$') {
      $env:SUPABASE_URL = $Matches[1].Trim()
    }
  }
}

if (-not $env:SUPABASE_ACCESS_TOKEN) {
  throw 'SUPABASE_ACCESS_TOKEN not found in .env.local'
}

$cli = Join-Path $env:USERPROFILE '.local\bin\supabase.exe'
$keysJson = & $cli projects api-keys --project-ref oqybniefkbppptfatoae 2>$null | Out-String
$parsed = $keysJson | ConvertFrom-Json
$service = $parsed.keys | Where-Object { $_.name -eq 'service_role' } | Select-Object -First 1
if (-not $service) {
  throw 'Could not resolve service_role key via Supabase CLI'
}

$env:SUPABASE_SERVICE_ROLE_KEY = $service.api_key
Write-Output 'Migration env ready (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY set in current process only).'
