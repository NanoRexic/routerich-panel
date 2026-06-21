#!/usr/bin/env python3
"""RouteRich panel uninstaller for Windows."""

from __future__ import annotations

import argparse
import getpass
import sys
from pathlib import Path

try:
    import paramiko
except ImportError:
    print("Error: paramiko is not installed. Run 1-Install-Prerequisites.bat first.", file=sys.stderr)
    sys.exit(2)

INSTALLER_DIR = Path(__file__).resolve().parent

sys.path.insert(0, str(INSTALLER_DIR))
from config_store import warn_legacy_config  # noqa: E402
from github_config import UNINSTALL_SCRIPT_URL  # noqa: E402
from netutil import detect_default_gateway  # noqa: E402
from sshutil import connect_ssh, format_ssh_error  # noqa: E402


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


def prompt_password() -> str:
    try:
        return getpass.getpass("SSH password (Enter = empty): ")
    except (EOFError, KeyboardInterrupt):
        print()
        raise SystemExit(1)


def resolve_password(cli_password: str | None, empty_password: bool) -> str:
    if empty_password:
        print("SSH password: empty (--empty-password)")
        return ""
    if cli_flag_value("--password") is not None:
        return cli_password if cli_password is not None else ""
    return prompt_password()


def run_remote_uninstall(client: paramiko.SSHClient) -> None:
    cmd = (
        f"wget -qO- '{UNINSTALL_SCRIPT_URL}' 2>/dev/null | sh "
        f"|| curl -fsSL '{UNINSTALL_SCRIPT_URL}' | sh"
    )
    code, out, err = run_cmd(client, cmd, timeout=120)
    combined = (out + "\n" + err).strip()
    if combined:
        for line in combined.splitlines():
            print(f"  {line}")
    if code != 0:
        raise RuntimeError(f"Remote uninstall failed:\n{combined}")


def run_local_uninstall(client: paramiko.SSHClient) -> None:
    cmds = [
        ("Remove uhttpd.panel", "uci -q delete uhttpd.panel 2>/dev/null; uci commit uhttpd 2>/dev/null; /etc/init.d/uhttpd restart 2>/dev/null"),
        ("Remove web files", "rm -rf /www/routerich-panel"),
        ("Remove panel data", "rm -rf /etc/routerich-panel"),
    ]
    for label, cmd in cmds:
        print(f"  {label}...")
        run_cmd(client, cmd, timeout=60)


def main() -> int:
    warn_legacy_config()

    parser = argparse.ArgumentParser(description="Uninstall RouteRich panel")
    parser.add_argument("--host", default=None, help="Router IP override")
    parser.add_argument("--user", default="root", help="SSH username")
    parser.add_argument("--password", default=None, help="SSH password")
    parser.add_argument("--empty-password", action="store_true", help="Use empty SSH password")
    parser.add_argument("--ssh-port", type=int, default=22, help="SSH port")
    parser.add_argument("--local", action="store_true", help="Run uninstall commands directly (no wget)")
    args = parser.parse_args()

    host = cli_flag_value("--host")
    if host:
        print(f"Using router IP from --host: {host}")
    else:
        print("Detecting router IP from active physical adapter (DHCP server)...")
        detected, debug = detect_default_gateway(verbose=True)
        for line in debug:
            print(f"  {line}")
        host = detected
        if host:
            print(f"Auto-detected router: {host}")

    if not host:
        print("Error: could not detect router IP. Use --host ROUTER_IP", file=sys.stderr)
        return 1

    password = resolve_password(args.password, args.empty_password)

    print()
    print("=== RouteRich panel uninstall ===")
    print(f"Router: {args.user}@{host}:{args.ssh_port}")
    print()

    try:
        client = connect_ssh(host, args.user, password, args.ssh_port)
    except Exception as exc:
        print(f"SSH error: {format_ssh_error(exc, host)}", file=sys.stderr)
        return 1

    try:
        if args.local:
            run_local_uninstall(client)
        else:
            try:
                run_remote_uninstall(client)
            except Exception:
                print("Remote uninstall failed, running commands directly...")
                run_local_uninstall(client)
        print()
        print("Panel removed from router.")
        print()
        return 0
    finally:
        client.close()


if __name__ == "__main__":
    sys.exit(main())