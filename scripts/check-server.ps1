$tcp = New-Object System.Net.Sockets.TcpClient
try {
  $tcp.Connect('127.0.0.1', 5173)
  Write-Output 'Server is running'
} catch {
  Write-Output 'Server NOT running'
} finally {
  $tcp.Dispose()
}
