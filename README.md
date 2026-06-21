# RouteRich Panel

Web panel for OpenWrt routers (Routerich style): reboot, AmneziaWG awg10, Zapret Manager, Opera-Proxy fix.

**Repository:** [github.com/NanoRexic/routerich-panel](https://github.com/NanoRexic/routerich-panel)

## Install on OpenWrt (SSH / terminal)

One command on the router:

```sh
wget -O - https://github.com/NanoRexic/routerich-panel/raw/refs/heads/main/install.sh | sh
```

Custom port:

```sh
PANEL_PORT=2021 wget -O - https://github.com/NanoRexic/routerich-panel/raw/refs/heads/main/install.sh | sh
```

Uninstall:

```sh
wget -O - https://github.com/NanoRexic/routerich-panel/raw/refs/heads/main/uninstall.sh | sh
```

Note: use `github.com/.../raw/...` URLs, not `raw.githubusercontent.com` — on routers with Zapret hosts overrides the latter may serve stale files.

Panel opens on port **2020** (fallback: 2021, 8080, 8888). Ports 80 and 443 are not used.

After update: hard refresh in browser (**Ctrl+F5**) for Service Worker cache.

### GitHub access on router

If `raw.githubusercontent.com` is blocked, add GitHub hosts to `/etc/hosts` (same as Zapret Manager) or install from Windows (see below).

## Install from Windows

1. Download **RouteRich-Windows.zip** from [Releases](https://github.com/NanoRexic/routerich-panel/releases) (or clone this repo and use the `windows/` folder).
2. Run `1-Install-Prerequisites.bat` (once per PC).
3. Run `2-Install-Panel.bat`.

The installer connects via SSH and runs `install.sh` on the router. If the router cannot reach GitHub, it automatically retries by downloading files on the PC and uploading via SSH.

Options (pass to `2-Install-Panel.bat` or `install.py`):

| Flag | Description |
|------|-------------|
| `--host IP` | Router IP (default: auto-detect gateway) |
| `--empty-password` | Empty SSH password |
| `--password PASS` | SSH password on command line |
| `--local-upload` | Force PC download + SSH upload |
| `--test-ssh` | Test SSH only |

Uninstall: `3-Uninstall-Panel.bat`

## Requirements

- OpenWrt with `uhttpd`
- `wget` or `curl` on router (for GitHub install)
- `jq` (installed automatically during setup if possible)

## Development

Local quick deploy (Kirill router):

```bash
python windows/install.py --host 192.168.0.1 --password YOUR_PASSWORD
```

Or SSH to router and re-run the one-liner install command.