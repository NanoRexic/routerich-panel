"""GitHub source for RouteRich panel files."""

GITHUB_USER = "NanoRexic"
GITHUB_REPO = "routerich-panel"
GITHUB_BRANCH = "main"
# github.com/raw avoids stale cache when raw.githubusercontent.com is in /etc/hosts (Zapret)
REPO_RAW = f"https://github.com/{GITHUB_USER}/{GITHUB_REPO}/raw/refs/heads/{GITHUB_BRANCH}"
INSTALL_SCRIPT_URL = f"{REPO_RAW}/install.sh"
UNINSTALL_SCRIPT_URL = f"{REPO_RAW}/uninstall.sh"
MANIFEST_URL = f"{REPO_RAW}/files.manifest"