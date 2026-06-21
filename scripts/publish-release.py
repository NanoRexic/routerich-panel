#!/usr/bin/env python3
"""Create GitHub Release and upload Windows installer zip."""

from __future__ import annotations

import json
import mimetypes
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path

REPO = "NanoRexic/routerich-panel"
ROOT = Path(__file__).resolve().parent.parent


def git_github_token() -> str:
    proc = subprocess.run(
        ["git", "credential-manager", "get"],
        input="protocol=https\nhost=github.com\n\n",
        capture_output=True,
        text=True,
        check=False,
    )
    if proc.returncode != 0:
        raise RuntimeError("Не удалось получить GitHub token из credential manager")
    password = ""
    for line in proc.stdout.splitlines():
        if line.startswith("password="):
            password = line.split("=", 1)[1]
    if not password:
        raise RuntimeError("GitHub token не найден")
    return password


def api_request(token: str, method: str, url: str, data: bytes | None = None, headers: dict | None = None):
    req_headers = {"Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json", "User-Agent": "routerich-panel-release"}
    if headers:
        req_headers.update(headers)
    req = urllib.request.Request(url, data=data, headers=req_headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            body = resp.read()
            return resp.status, json.loads(body) if body else None
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"GitHub API {exc.code}: {detail}") from exc


def main() -> int:
    version = (ROOT / "VERSION").read_text(encoding="utf-8").strip()
    tag = f"v{version}"
    zip_path = ROOT / f"RouteRich-Windows-v{version}.zip"
    if not zip_path.is_file():
        print(f"Missing {zip_path.name}. Run scripts/build-windows-release.ps1 first.", file=sys.stderr)
        return 1

    token = git_github_token()
    release_body = (
        f"## RouteRich Panel {version}\n\n"
        "### Windows-установщик\n"
        f"Скачайте **`{zip_path.name}`**, распакуйте и запустите:\n"
        "1. `1-Install-Prerequisites.bat`\n"
        "2. `2-Install-Panel.bat`\n\n"
        "Установщик подключается к Routerich по SSH и ставит панель на роутер.\n"
    )

    status, existing = api_request(token, "GET", f"https://api.github.com/repos/{REPO}/releases/tags/{tag}")
    if status == 200 and existing:
        release = existing
        print(f"Release {tag} already exists, uploading asset...")
    else:
        payload = json.dumps(
            {
                "tag_name": tag,
                "name": tag,
                "body": release_body,
                "draft": False,
                "make_latest": True,
            }
        ).encode("utf-8")
        _, release = api_request(
            token,
            "POST",
            f"https://api.github.com/repos/{REPO}/releases",
            data=payload,
            headers={"Content-Type": "application/json"},
        )
        print(f"Created release {tag}")

    upload_url = release["upload_url"].split("{", 1)[0]
    asset_name = zip_path.name
    with zip_path.open("rb") as fh:
        data = fh.read()
    content_type = mimetypes.guess_type(asset_name)[0] or "application/zip"
    api_request(
        token,
        "POST",
        f"{upload_url}?name={asset_name}",
        data=data,
        headers={"Content-Type": content_type},
    )
    print(f"Uploaded {asset_name}")
    print(release.get("html_url", ""))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())