#!/usr/bin/env python3
"""RouteRich panel installer for Windows — SSH to OpenWrt router."""

from __future__ import annotations

import argparse
import getpass
import json
import re
import sys
import tempfile
import urllib.error
import urllib.request
import webbrowser
from pathlib import Path

try:
    import paramiko
except ImportError:
    print("Error: paramiko is not installed.", file=sys.stderr)
    print("Run first: 1-Install-Prerequisites.bat", file=sys.stderr)
    sys.exit(2)

INSTALLER_DIR = Path(__file__).resolve().parent

sys.path.insert(0, str(INSTALLER_DIR))
from config_store import append_install_history, print_install_history, warn_legacy_config  # noqa: E402
from github_config import INSTALL_SCRIPT_URL, MANIFEST_URL, REPO_RAW  # noqa: E402
from netutil import detect_default_gateway  # noqa: E402
from sshutil import NativeSSHClient, connect_ssh, format_ssh_error  # noqa: E402

FORBIDDEN_PORTS = {80, 443}
UA = "Mozilla/5.0 (compatible; RouteRich-Windows-Installer/1.0)"


def cli_flag_value(flag: str) -> str | None:
    if flag not in sys.argv:
        return None
    for i, arg in enumerate(sys.argv):
        if arg == flag and i + 1 < len(sys.argv):
            return sys.argv[i + 1]
        if arg.startswith(flag + "="):
            return arg.split("=", 1)[1]
    return None


def run_cmd(client: paramiko.SSHClient, command: str, timeout: int = 120) -> tuple[int, str, str]:
    stdin, stdout, stderr = client.exec_command(command, timeout=timeout)
    out = stdout.read().decode("utf-8", errors="replace")
    err = stderr.read().decode("utf-8", errors="replace")
    code = stdout.channel.recv_exit_status()
    return code, out, err


def upload_file(client: paramiko.SSHClient | NativeSSHClient, local: Path, remote: str, mode: str) -> None:
    if isinstance(client, NativeSSHClient):
        client.upload_file(local, remote, mode)
        return
    remote_dir = remote.rsplit("/", 1)[0]
    run_cmd(client, f"mkdir -p '{remote_dir}'", timeout=30)
    with local.open("rb") as f:
        data = f.read()
    stdin, stdout, stderr = client.exec_command(f"cat > '{remote}'", timeout=120)
    stdin.write(data)
    stdin.channel.shutdown_write()
    err = stderr.read().decode("utf-8", errors="replace")
    if err.strip():
        raise RuntimeError(f"Upload failed for {remote}: {err.strip()}")
    stdout.read()
    run_cmd(client, f"chmod {mode} '{remote}'", timeout=15)


def fetch_url(url: str, timeout: int = 60) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read()


def load_manifest_from_github() -> dict:
    data = fetch_url(MANIFEST_URL)
    return json.loads(data.decode("utf-8"))


def download_panel_to_temp(manifest: dict) -> Path:
    tmp = Path(tempfile.mkdtemp(prefix="routerich-panel-"))
    for entry in manifest["files"]:
        src = entry["src"]
        url = f"{REPO_RAW}/{src}"
        local_path = tmp / src
        local_path.parent.mkdir(parents=True, exist_ok=True)
        local_path.write_bytes(fetch_url(url))
    setup = tmp / "setup-panel.sh"
    setup.write_bytes(fetch_url(f"{REPO_RAW}/setup-panel.sh"))
    return tmp


def deploy_files_from_dir(client: paramiko.SSHClient, manifest: dict, root: Path) -> None:
    for entry in manifest["files"]:
        src = root / entry["src"]
        if not src.is_file():
            raise FileNotFoundError(f"Downloaded file missing: {src}")
        upload_file(client, src, entry["dst"], entry["mode"])
        print(f"  OK {entry['dst']}")


def run_router_setup(client: paramiko.SSHClient, setup_script: Path, preferred_port: int) -> dict:
    upload_file(client, setup_script, "/tmp/routerich-setup-panel.sh", "755")
    code, out, err = run_cmd(
        client,
        f"sh /tmp/routerich-setup-panel.sh {preferred_port}",
        timeout=180,
    )
    combined = (out + "\n" + err).strip()
    if code != 0:
        raise RuntimeError(f"Router setup failed:\n{combined}")
    result = {}
    for line in out.splitlines():
        if "=" in line:
            key, val = line.split("=", 1)
            result[key.strip()] = val.strip()
    if "PANEL_PORT" not in result:
        raise RuntimeError(f"Could not detect panel port:\n{combined}")
    return result


def parse_install_output(output: str, host: str) -> tuple[str, str]:
    panel_url = ""
    panel_port = ""
    for line in output.splitlines():
        if "Panel URL:" in line:
            panel_url = line.split("Panel URL:", 1)[1].strip()
        m = re.search(r"port (\d+) was busy, using (\d+)", line)
        if m:
            panel_port = m.group(2)
    if not panel_url and panel_port:
        panel_url = f"http://{host}:{panel_port}/"
    if panel_url and not panel_port:
        m = re.search(r":(\d+)/", panel_url)
        if m:
            panel_port = m.group(1)
    return panel_url, panel_port


def run_remote_install(client: paramiko.SSHClient, host: str, panel_port: int) -> tuple[str, str]:
    cmd = (
        f"export PANEL_PORT={panel_port} REPO_RAW='{REPO_RAW}'; "
        f"wget -qO- '{INSTALL_SCRIPT_URL}' 2>/dev/null | sh "
        f"|| curl -fsSL '{INSTALL_SCRIPT_URL}' | sh"
    )
    print("Running install.sh on router (download from GitHub)...")
    code, out, err = run_cmd(client, cmd, timeout=300)
    combined = (out + "\n" + err).strip()
    if code != 0:
        raise RuntimeError(f"Remote install failed:\n{combined}")
    if combined:
        for line in combined.splitlines():
            print(f"  {line}")
    panel_url, chosen_port = parse_install_output(combined, host)
    if not panel_url:
        raise RuntimeError(f"Install finished but panel URL not found:\n{combined}")
    return panel_url, chosen_port or str(panel_port)


def verify_panel(client: paramiko.SSHClient, panel_port: str) -> bool:
    code, out, _ = run_cmd(
        client,
        f"curl -fsS -m 10 -o /dev/null -w '%{{http_code}}' 'http://127.0.0.1:{panel_port}/' 2>/dev/null || echo FAIL",
        timeout=20,
    )
    return out.strip() in {"200", "301", "302"}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Install RouteRich panel on OpenWrt")
    parser.add_argument("--host", default=None, help="Router IP override")
    parser.add_argument("--user", default="root", help="SSH username")
    parser.add_argument("--password", default=None, help="SSH password")
    parser.add_argument("--empty-password", action="store_true", help="Use empty SSH password")
    parser.add_argument("--ssh-port", type=int, default=22, help="SSH port")
    parser.add_argument("--panel-port", type=int, default=2020, help="Preferred panel HTTP port")
    parser.add_argument(
        "--local-upload",
        action="store_true",
        help="Download files on PC and upload via SSH (if router cannot reach GitHub)",
    )
    parser.add_argument("--save-history", action="store_true", help="Log successful install locally")
    parser.add_argument("--show-history", action="store_true", help="Show install history and exit")
    parser.add_argument("--test-ssh", action="store_true", help="Test SSH only")
    parser.add_argument("--verbose-ssh", action="store_true", help="Verbose SSH auth")
    parser.add_argument("--skip-verify", action="store_true", help="Skip HTTP check")
    parser.add_argument("--no-open-browser", action="store_true", help="Do not open browser")
    return parser.parse_args()


def format_clickable_url(url: str) -> str:
    return f"\033]8;;{url}\033\\{url}\033]8;;\033\\"


def open_panel_in_browser(url: str) -> bool:
    try:
        return webbrowser.open(url, new=2)
    except Exception:
        return False


def prompt_password() -> str:
    try:
        return getpass.getpass("SSH password (Enter = empty): ")
    except (EOFError, KeyboardInterrupt):
        print()
        raise SystemExit(1)


def resolve_host(cli_host: str | None) -> str:
    if cli_host:
        print(f"Using router IP from --host: {cli_host}")
        return cli_host
    print("Detecting router IP from active physical adapter (DHCP server)...")
    detected, debug = detect_default_gateway(verbose=True)
    for line in debug:
        print(f"  {line}")
    if detected:
        print(f"Auto-detected router: {detected}")
        return detected
    print("Warning: auto-detect failed.", file=sys.stderr)
    try:
        value = input("Router IP (gateway): ").strip()
    except (EOFError, KeyboardInterrupt):
        print()
        raise SystemExit(1)
    if not value:
        print("Error: router IP is required.", file=sys.stderr)
        raise SystemExit(1)
    return value


def resolve_password(cli_password: str | None, empty_password: bool) -> str:
    if empty_password:
        print("SSH password: empty (--empty-password)")
        return ""
    if cli_flag_value("--password") is not None:
        return cli_password if cli_password is not None else ""
    return prompt_password()


def install_local_upload(client: paramiko.SSHClient, panel_port: int, host: str) -> tuple[str, str]:
    print("Downloading panel files from GitHub...")
    try:
        manifest = load_manifest_from_github()
        tmp_root = download_panel_to_temp(manifest)
    except (urllib.error.URLError, OSError, json.JSONDecodeError) as exc:
        raise RuntimeError(f"Cannot download from GitHub: {exc}") from exc

    print("Uploading panel files...")
    deploy_files_from_dir(client, manifest, tmp_root)

    print("Configuring uhttpd on router...")
    setup = run_router_setup(client, tmp_root / "setup-panel.sh", panel_port)
    panel_port_str = setup["PANEL_PORT"]
    panel_url = setup.get("PANEL_URL", f"http://{host}:{panel_port_str}/")
    return panel_url, panel_port_str


def main() -> int:
    warn_legacy_config()
    args = parse_args()
    if args.show_history:
        print_install_history()
        return 0

    host = resolve_host(cli_flag_value("--host"))
    user = args.user or "root"
    password = resolve_password(args.password, args.empty_password)

    if args.test_ssh:
        print()
        print("=== SSH connection test ===")
        try:
            client = connect_ssh(host, user, password, args.ssh_port, verbose=args.verbose_ssh)
            code, out, _ = run_cmd(client, "echo OK", timeout=15)
            client.close()
            if code == 0 and "OK" in out:
                print("SSH test: OK")
                return 0
            print("SSH test: connected but command failed", file=sys.stderr)
            return 1
        except Exception as exc:
            print(f"SSH test failed: {format_ssh_error(exc, host)}", file=sys.stderr)
            return 1

    if args.panel_port in FORBIDDEN_PORTS:
        print("Error: ports 80 and 443 are reserved for LuCI.", file=sys.stderr)
        return 1

    print()
    print("=== RouteRich panel install ===")
    print(f"Router: {user}@{host}:{args.ssh_port}")
    print(f"Preferred panel port: {args.panel_port}")
    print(f"Mode: {'local upload' if args.local_upload else 'remote install.sh on router'}")
    print()

    try:
        print("Connecting via SSH...")
        client = connect_ssh(host, user, password, args.ssh_port)
    except Exception as exc:
        print(f"SSH error: {format_ssh_error(exc, host)}", file=sys.stderr)
        return 1

    try:
        if args.local_upload:
            panel_url, panel_port = install_local_upload(client, args.panel_port, host)
        else:
            try:
                panel_url, panel_port = run_remote_install(client, host, args.panel_port)
            except Exception as remote_exc:
                print(f"Remote install failed: {remote_exc}", file=sys.stderr)
                print("Retrying with --local-upload (download on PC, upload via SSH)...")
                panel_url, panel_port = install_local_upload(client, args.panel_port, host)

        if not args.skip_verify:
            print("Verifying panel HTTP...")
            if verify_panel(client, panel_port):
                print("  HTTP: OK")
            else:
                print("  Warning: HTTP check failed; panel may still be starting")

        if args.save_history:
            append_install_history(
                panel_url=panel_url,
                panel_port=int(panel_port),
                ssh_port=args.ssh_port,
                user=user,
            )

        print()
        print("=== Install complete ===")
        print(f"Panel URL: {format_clickable_url(panel_url)}")
        if str(panel_port) != str(args.panel_port):
            print(f"(port {args.panel_port} was busy, using {panel_port})")
        if not args.no_open_browser:
            if open_panel_in_browser(panel_url):
                print("Opening panel in your default browser...")
            else:
                print("Could not open browser automatically — click the URL above.")
        print()
        return 0
    except Exception as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1
    finally:
        client.close()


if __name__ == "__main__":
    sys.exit(main())