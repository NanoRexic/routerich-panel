"""Resolve bundled panel files for offline Windows installer."""

from __future__ import annotations

import json
from pathlib import Path

INSTALLER_DIR = Path(__file__).resolve().parent


def is_panel_root(path: Path) -> bool:
    return (path / "files.manifest").is_file() and (path / "setup-panel.sh").is_file()


def resolve_panel_root(explicit: Path | str | None = None) -> Path:
    if explicit is not None:
        root = Path(explicit).resolve()
        if not is_panel_root(root):
            raise FileNotFoundError(
                f"В каталоге нет files.manifest и setup-panel.sh: {root}"
            )
        return root

    bundled = INSTALLER_DIR / "panel"
    if is_panel_root(bundled):
        return bundled

    repo = INSTALLER_DIR.parent
    if is_panel_root(repo):
        return repo

    raise FileNotFoundError(
        "Локальные файлы панели не найдены.\n"
        f"  Ожидался каталог: {bundled}\n"
        f"  или корень репозитория: {repo}\n"
        "Для релизного архива запустите scripts/build-windows-release.ps1."
    )


def load_manifest(panel_root: Path) -> dict:
    with (panel_root / "files.manifest").open(encoding="utf-8") as f:
        return json.load(f)


def setup_script_path(panel_root: Path) -> Path:
    return panel_root / "setup-panel.sh"