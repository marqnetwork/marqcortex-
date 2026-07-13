# MARQ Cortex — Supabase CLI wrapper for Windows SSL/proxy environments.
# Usage: .\scripts\supabase-cli.ps1 projects list
#        .\scripts\supabase-cli.ps1 link --project-ref oqybniefkbppptfatoae

$ErrorActionPreference = 'Stop'
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
$cli = Join-Path $env:USERPROFILE '.local\bin\supabase.exe'
if (-not (Test-Path $cli)) {
  throw "Supabase CLI not found at $cli"
}

& $cli @args
