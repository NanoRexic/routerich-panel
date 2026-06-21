#!/usr/bin/env python3
"""RouteRich panel installer — deploy files to OpenWrt router via SSH."""

from __future__ import annotations

import argparse
import getpass
import sys
import webbrowser
from pathlib import Path

try:
    import paramiko
except ImportError:
    print("Error: paramiko is not installed.", file=sys.stderr)
    print("Run first: installer\\Install-Prerequisites.ps1", file=sys.stderr)
    sys.exit(2)

INSTALLER_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = INSTALLER_DIR.parent

sys.path.insert(0, str(INSTALLER_DIR))
from config_store import append_install_history, print_install_history, warn_legacy_config  # noqa: E402
from netutil import detect_default_gateway  # noqa: E402
from sshutil import NativeSSHClient, connect_ssh, format_ssh_error  # noqa: E402

MANIFEST_PATH = INSTALLER_DIR / "files.manifest"
SETUP_SCRIPT = INSTALLER_DIR / "router" / "setup-panel.sh"
FORBIDDEN_PORTS = {80, 443}


def load_manifest() -> dict:
    with MANIFEST_PATH.open(encoding="utf-8") as f:
        return __import__("json").load(f)


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


def deploy_files(client: paramiko.SSHClient, manifest: dict) -> list[str]:
    uploaded = []
    for entry in manifest["files"]:
        src = PROJECT_ROOT / entry["src"]
        if not src.is_file():
            raise FileNotFoundError(f"File not found: {src}")
        upload_file(client, src, entry["dst"], entry["mode"])
        uploaded.append(entry["dst"])
        print(f"  OK {entry['dst']}")
    return uploaded


def run_router_setup(client: paramiko.SSHClient, preferred_port: int) -> dict:
    upload_file(client, SETUP_SCRIPT, "/tmp/routerich-setup-panel.sh", "755")
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


def verify_panel(client: paramiko.SSHClient, panel_port: str) -> bool:
    code, out, _ = run_cmd(
        client,
        f"curl -fsS -m 10 -o /dev/null -w '%{{http_code}}' 'http://127.0.0.1:{panel_port}/' 2>/dev/null || echo FAIL",
        timeout=20,
    )
    return out.strip() in {"200", "301", "302"}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Install RouteRich panel on OpenWrt")
    parser.add_argument(
        "--host",
        default=None,
        help="Router IP override (default: auto-detect from active adapter DHCP)",
    )
    parser.add_argument("--user", default="root", help="SSH username")
    parser.add_argument(
        "--password",
        default=None,
        help="SSH password on command line (use --empty-password for no password)",
    )
    parser.add_argument(
        "--empty-password",
        action="store_true",
        help="Use empty SSH password without prompting",
    )
    parser.add_argument("--ssh-port", type=int, default=22, help="SSH port")
    parser.add_argument("--panel-port", type=int, default=2020, help="Preferred panel HTTP port")
    parser.add_argument(
        "--save-history",
        action="store_true",
        help="Append successful install to local history log (never auto-loaded)",
    )
    parser.add_argument(
        "--show-history",
        action="store_true",
        help="Show recent installs on this PC and exit",
    )
    parser.add_argument(
        "--test-ssh",
        action="store_true",
        help="Test SSH connection only and exit",
    )
    parser.add_argument(
        "--verbose-ssh",
        action="store_true",
        help="Show detailed SSH authentication attempts",
    )
    parser.add_argument("--skip-verify", action="store_true", help="Skip HTTP verification")
    parser.add_argument(
        "--no-open-browser",
        action="store_true",
        help="Do not open panel URL in the default browser after install",
    )
    return parser.parse_args()


def format_clickable_url(url: str) -> str:
    """OSC 8 hyperlink for Windows Terminal, VS Code, and other modern terminals."""
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

    manifest = load_manifest()

    if args.panel_port in FORBIDDEN_PORTS:
        print("Error: ports 80 and 443 are reserved for LuCI.", file=sys.stderr)
        return 1

    print()
    print("=== RouteRich panel install ===")
    print(f"Router: {user}@{host}:{args.ssh_port}")
    print(f"Preferred panel port: {args.panel_port}")
    print()

    try:
        print("Connecting via SSH...")
        client = connect_ssh(host, user, password, args.ssh_port)
    except Exception as exc:
        print(f"SSH error: {format_ssh_error(exc, host)}", file=sys.stderr)
        return 1

    try:
        print("Uploading panel files...")
        deploy_files(client, manifest)

        print("Configuring uhttpd on router...")
        setup = run_router_setup(client, args.panel_port)
        panel_port = setup["PANEL_PORT"]
        panel_url = setup.get("PANEL_URL", f"http://{host}:{panel_port}/")

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
        if panel_port != str(args.panel_port):
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