# Detect router IP from active physical adapter DHCP server (Windows)
$ErrorActionPreference = 'SilentlyContinue'

$VirtualPattern = 'Virtual|Hyper-V|VMware|VirtualBox|TAP|TUN|WSL|Loopback|VPN|Tunnel|NordLynx|WireGuard|Bluetooth|Npcap|Packet|ZeroTier|Tailscale|Hamachi|Radmin|OpenVPN|WireSock|sing-box|vEthernet|Teredo|isatap|6to4'

function Test-RouterIp([string]$Ip) {
    if (-not $Ip) { return $false }
    if ($Ip -eq '0.0.0.0' -or $Ip -eq '255.255.255.255') { return $false }
    return $Ip -match '^(?:\d{1,3}\.){3}\d{1,3}$'
}

function Get-ActiveConfigs {
    Get-NetIPConfiguration -ErrorAction SilentlyContinue |
        Where-Object {
            $_.NetAdapter -and
            $_.NetAdapter.Status -eq 'Up' -and
            $_.NetAdapter.Virtual -eq $false -and
            $_.IPv4Address -and
            $_.NetAdapter.InterfaceDescription -notmatch $VirtualPattern -and
            $_.NetAdapter.Name -notmatch $VirtualPattern
        } |
        Sort-Object `
            @{ Expression = { $_.NetAdapter.InterfaceMetric } }, `
            @{ Expression = { if ($_.IPv4Address.PrefixOrigin -eq 'Dhcp') { 0 } else { 1 } } }
}

$configs = @(Get-ActiveConfigs)
if ($configs.Count -eq 0) {
    exit 1
}

foreach ($cfg in $configs) {
    $dhcp = $null
    if ($cfg.DhcpServer -and $cfg.DhcpServer.IPv4Address) {
        $dhcp = $cfg.DhcpServer.IPv4Address.ToString()
    }
    if (Test-RouterIp $dhcp) {
        [Console]::Error.WriteLine(
            "adapter: $($cfg.InterfaceAlias) | source: DHCP server | ip: $dhcp"
        )
        Write-Output $dhcp
        exit 0
    }
}

foreach ($cfg in $configs) {
    $gw = $null
    if ($cfg.IPv4DefaultGateway -and $cfg.IPv4DefaultGateway.NextHop) {
        $gw = $cfg.IPv4DefaultGateway.NextHop.ToString()
    }
    if (Test-RouterIp $gw) {
        [Console]::Error.WriteLine(
            "adapter: $($cfg.InterfaceAlias) | source: default gateway | ip: $gw"
        )
        Write-Output $gw
        exit 0
    }
}

exit 1