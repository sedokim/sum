$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$bundledNode = Join-Path $env:USERPROFILE ".cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
$nodeExecutable = if (Test-Path -LiteralPath $bundledNode) { $bundledNode } else { "node" }
$connection = [System.Net.Sockets.TcpClient]::new()

try {
  $connection.Connect("127.0.0.1", 4173)
  exit 0
} catch {
  # No API server is listening yet.
} finally {
  $connection.Dispose()
}

Start-Process -FilePath $nodeExecutable -ArgumentList "server.js" -WorkingDirectory $projectRoot -WindowStyle Hidden
