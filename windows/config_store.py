"""Install history on this PC only (write-only, never used during install)."""

from __future__ import annotations

import json
import os
import platform
from datetime import datetime, timezone
from pathlib import Path

INSTALLER_DIR = Path(__file__).resolve().parent
LEGACY_CONFIG_PATH = INSTALLER_DIR / "install.config.json"
LEGACY_USER_CONFIG = "panel-install.json"
HISTORY_FILENAME = "panel-install-history.json"
MAX_HISTORY = 10


def user_data_dir() -> Path:
    system = platform.system().lower()
    if system == "windows":
        base = os.environ.get("LOCALAPPDATA") or os.environ.get("APPDATA")
        if base:
            return Path(base) / "RouteRich"
    return Path.home() / ".config" / "routerich"


def history_path() -> Path:
    return user_data_dir() / HISTORY_FILENAME


def legacy_user_config_path() -> Path:
    return user_data_dir() / LEGACY_USER_CONFIG


def warn_legacy_config() -> None:
    import sys

    for path in (LEGACY_CONFIG_PATH, legacy_user_config_path()):
        if not path.is_file():
            continue
        print(
            f"Note: ignored legacy config {path}",
            file=sys.stderr,
        )
        print(
            "       Install always auto-detects router IP and prompts for password.",
            file=sys.stderr,
        )
        break


def append_install_history(
    *,
    panel_url: str,
    panel_port: int,
    ssh_port: int,
    user: str,
) -> None:
    path = history_path()
    path.parent.mkdir(parents=True, exist_ok=True)

    data: dict = {"history": []}
    if path.is_file():
        try:
            loaded = json.loads(path.read_text(encoding="utf-8"))
            if isinstance(loaded.get("history"), list):
                data = loaded
        except (OSError, json.JSONDecodeError):
            pass

    entry = {
        "panel_url": panel_url,
        "panel_port": panel_port,
        "ssh_port": ssh_port,
        "user": user,
        "installed_at": datetime.now(timezone.utc).isoformat(),
    }
    data["history"] = [entry] + data["history"]
    data["history"] = data["history"][:MAX_HISTORY]
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def print_install_history() -> None:
    path = history_path()
    if not path.is_file():
        print("No install history on this PC.")
        return
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        print("Install history file is unreadable.")
        return
    history = data.get("history") or []
    if not history:
        print("No install history on this PC.")
        return
    print("Recent installs on this PC (informational only):")
    for item in history[:5]:
        when = item.get("installed_at", "?")
        url = item.get("panel_url", "?")
        print(f"  - {when}: {url}")