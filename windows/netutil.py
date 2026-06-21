"""Detect router IP from the active physical network adapter on the local PC."""

from __future__ import annotations

import platform
import re
import subprocess
from pathlib import Path

INSTALLER_DIR = Path(__file__).resolve().parent
_DETECT_PS1 = INSTALLER_DIR / "detect-gateway.ps1"

_IPV4_RE = re.compile(r"\b(\d{1,3}(?:\.\d{1,3}){3})\b")

_VIRTUAL_ADAPTER_RE = re.compile(
    r"virtual|hyper-v|vmware|virtualbox|tap|tun|wsl|loopback|vpn|tunnel|"
    r"nordlynx|wireguard|bluetooth|npcap|packet|zerotier|tailscale|hamachi|"
    r"radmin|openvpn|wiresock|sing-box|vethernet|teredo|isatap|6to4",
    re.IGNORECASE,
)

_DHCP_SERVER_RE = re.compile(
    r"dhcp\s*(?:server|сервер)",
    re.IGNORECASE,
)

_DEFAULT_GATEWAY_RE = re.compile(
    r"(?:default\s*gateway|основной\s*шлюз)",
    re.IGNORECASE,
)


def _valid_ipv4(addr: str) -> bool:
    if not addr or addr in {"0.0.0.0", "255.255.255.255"}:
        return False
    parts = addr.split(".")
    if len(parts) != 4:
        return False
    try:
        return all(0 <= int(p) <= 255 for p in parts)
    except ValueError:
        return False


def detect_default_gateway(verbose: bool = False) -> tuple[str | None, list[str]]:
    debug: list[str] = []
    system = platform.system().lower()

    if system == "windows":
        ip, dbg = _detect_windows_active(verbose)
        debug.extend(dbg)
        if ip:
            return ip, debug
        ip, dbg = _detect_ipconfig_all(verbose)
        debug.extend(dbg)
        return ip, debug

    if system in {"linux", "darwin"}:
        ip = _detect_unix()
        if verbose:
            debug.append("unix default route lookup")
        return ip, debug

    if verbose:
        debug.append("unsupported OS")
    return None, debug


def _detect_windows_active(verbose: bool) -> tuple[str | None, list[str]]:
    debug: list[str] = []
    if not _DETECT_PS1.is_file():
        debug.append("detect-gateway.ps1 not found")
        return None, debug

    if verbose:
        debug.append("method: active adapter + DHCP server (PowerShell)")

    try:
        result = subprocess.run(
            [
                "powershell",
                "-NoProfile",
                "-ExecutionPolicy",
                "Bypass",
                "-File",
                str(_DETECT_PS1),
            ],
            capture_output=True,
            text=True,
            timeout=20,
            check=False,
        )
        for line in (result.stderr or "").splitlines():
            line = line.strip()
            if line:
                debug.append(line)

        for line in (result.stdout or "").splitlines():
            candidate = line.strip()
            if _valid_ipv4(candidate):
                if verbose:
                    debug.append(f"result: {candidate}")
                return candidate, debug

        if verbose and result.returncode != 0:
            debug.append("PowerShell detect returned no IP")
    except (OSError, subprocess.TimeoutExpired) as exc:
        debug.append(f"PowerShell detect error: {exc}")

    return None, debug


def _detect_ipconfig_all(verbose: bool) -> tuple[str | None, list[str]]:
    debug: list[str] = []
    if verbose:
        debug.append("method: ipconfig /all fallback")

    try:
        result = subprocess.run(
            ["ipconfig", "/all"],
            capture_output=True,
            text=True,
            timeout=20,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        debug.append(f"ipconfig error: {exc}")
        return None, debug

    text = result.stdout or ""
    blocks = re.split(r"\r?\n\r?\n", text)
    candidates: list[tuple[int, str, str | None, str | None]] = []

    for block in blocks:
        header = block.splitlines()[0] if block.strip() else ""
        if not header.strip().endswith(":"):
            continue
        adapter_name = header.strip().rstrip(":")
        if _VIRTUAL_ADAPTER_RE.search(adapter_name):
            if verbose:
                debug.append(f"skip virtual adapter: {adapter_name}")
            continue

        dhcp_ip = None
        gateway_ip = None
        dhcp_enabled = False
        has_ipv4 = False

        for line in block.splitlines():
            low = line.lower()
            if "ipv4" in low and "address" in low:
                if _IPV4_RE.search(line):
                    has_ipv4 = True
            if "dhcp enabled" in low or "dhcp включен" in low:
                if "yes" in low or "да" in low:
                    dhcp_enabled = True
            if _DHCP_SERVER_RE.search(line):
                match = _IPV4_RE.search(line)
                if match:
                    dhcp_ip = match.group(1)
            if _DEFAULT_GATEWAY_RE.search(line):
                match = _IPV4_RE.search(line)
                if match:
                    gateway_ip = match.group(1)

        if not has_ipv4:
            continue

        score = 0
        if dhcp_enabled:
            score += 2
        if dhcp_ip:
            score += 4
        if gateway_ip:
            score += 1
        if "ethernet" in adapter_name.lower() or "wi-fi" in adapter_name.lower() or "wlan" in adapter_name.lower():
            score += 1

        router_ip = dhcp_ip or gateway_ip
        if router_ip and _valid_ipv4(router_ip):
            candidates.append((score, adapter_name, dhcp_ip, gateway_ip))
            if verbose:
                src = "DHCP" if dhcp_ip else "gateway"
                debug.append(f"candidate: {adapter_name} -> {router_ip} ({src})")

    if not candidates:
        debug.append("no suitable adapter found in ipconfig /all")
        return None, debug

    candidates.sort(key=lambda item: item[0], reverse=True)
    best = candidates[0]
    ip = best[2] or best[3]
    if verbose and ip:
        debug.append(f"selected: {best[1]} -> {ip}")
    return ip, debug


def _detect_unix() -> str | None:
    try:
        result = subprocess.run(
            ["ip", "route", "show", "default"],
            capture_output=True,
            text=True,
            timeout=12,
            check=False,
        )
        if result.returncode == 0:
            match = re.search(r"default via (\d{1,3}(?:\.\d{1,3}){3})", result.stdout)
            if match and _valid_ipv4(match.group(1)):
                return match.group(1)
    except (OSError, subprocess.TimeoutExpired):
        pass

    try:
        result = subprocess.run(
            ["route", "-n", "get", "default"],
            capture_output=True,
            text=True,
            timeout=12,
            check=False,
        )
        if result.returncode == 0:
            match = re.search(r"gateway:\s*(\d{1,3}(?:\.\d{1,3}){3})", result.stdout)
            if match and _valid_ipv4(match.group(1)):
                return match.group(1)
    except (OSError, subprocess.TimeoutExpired):
        pass

    return None