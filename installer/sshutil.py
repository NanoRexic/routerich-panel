"""SSH helpers: host key refresh and OpenWrt/Dropbear-friendly auth."""

from __future__ import annotations

import os
import shutil
import socket
import subprocess
import sys
import tempfile
from pathlib import Path

try:
    import paramiko
except ImportError:
    paramiko = None  # type: ignore

SSH_DEPS = ("paramiko", "cryptography", "bcrypt", "pynacl", "cffi")


def _known_hosts_path() -> Path:
    return Path.home() / ".ssh" / "known_hosts"


def ensure_ssh_dependencies() -> None:
    if paramiko is None:
        raise RuntimeError("paramiko is not installed. Run Install-Prerequisites.ps1")
    try:
        import cryptography  # noqa: F401
        return
    except ImportError:
        pass
    print("Installing SSH dependencies (cryptography, bcrypt)...")
    subprocess.run(
        [sys.executable, "-m", "pip", "install", "--upgrade", *SSH_DEPS, "--no-warn-script-location"],
        check=False,
        timeout=300,
    )


def force_remove_known_host(host: str, port: int = 22) -> bool:
    removed = False
    for target in (host, f"[{host}]:{port}"):
        try:
            result = subprocess.run(
                ["ssh-keygen", "-R", target],
                capture_output=True,
                text=True,
                timeout=15,
                check=False,
            )
            out = ((result.stdout or "") + (result.stderr or "")).lower()
            if "found:" in out or "updated" in out:
                removed = True
        except (OSError, subprocess.TimeoutExpired):
            pass

    path = _known_hosts_path()
    if path.is_file():
        try:
            lines = path.read_text(encoding="utf-8", errors="ignore").splitlines(keepends=True)
            kept: list[str] = []
            changed = False
            for line in lines:
                raw = line.strip()
                if raw.startswith("#") and host in raw:
                    changed = True
                    continue
                if host in raw and (raw.startswith(host) or raw.startswith("|")):
                    changed = True
                    continue
                kept.append(line)
            if changed:
                path.write_text("".join(kept), encoding="utf-8")
                removed = True
        except OSError:
            pass

    if paramiko and path.is_file():
        try:
            hostkeys = paramiko.HostKeys()
            hostkeys.load(str(path))
            for name in list(hostkeys.keys()):
                if host in name:
                    del hostkeys[name]
                    removed = True
            if removed:
                hostkeys.save(str(path))
        except (OSError, paramiko.SSHException):
            pass

    return removed


def check_tcp_port(host: str, port: int = 22, timeout: float = 5.0) -> bool:
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except OSError:
        return False


def _kbd_handler(password: str):
    def handler(title, instructions, prompt_list):
        if not prompt_list:
            return []
        return [password for _ in prompt_list]

    return handler


def _password_value(password: str | None) -> str:
    return "" if password is None else password


def _auth_method_order(password: str, allowed: list[str] | None) -> list[str]:
    pwd = _password_value(password)
    if pwd == "":
        preferred = ("password", "keyboard-interactive", "none")
    else:
        preferred = ("password", "keyboard-interactive")

    if not allowed:
        return list(preferred)

    allowed_set = {item.lower() for item in allowed}
    ordered = [name for name in preferred if name in allowed_set]
    if ordered:
        return ordered
    return list(preferred)


def _probe_allowed_auth_methods(host: str, user: str, port: int) -> list[str]:
    sock = None
    transport = None
    try:
        sock = socket.create_connection((host, port), timeout=25)
        transport = paramiko.Transport(sock)
        transport.connect()
        return list(transport.get_allowed_auths(user))
    except Exception:
        return []
    finally:
        if transport is not None:
            try:
                transport.close()
            except Exception:
                pass
        elif sock is not None:
            try:
                sock.close()
            except Exception:
                pass


def _try_auth_on_transport(
    transport: "paramiko.Transport",
    user: str,
    password: str | None,
    method: str,
) -> None:
    pwd = _password_value(password)
    if method == "none":
        transport.auth_none(user)
    elif method == "password":
        transport.auth_password(user, pwd)
    elif method == "keyboard-interactive":
        transport.auth_interactive(user, _kbd_handler(pwd))
    else:
        raise paramiko.BadAuthenticationType(f"unsupported method: {method}")


def _connect_paramiko_transport(
    host: str,
    user: str,
    password: str | None,
    port: int,
    verbose: bool = False,
) -> tuple["paramiko.SSHClient", str]:
    pwd = _password_value(password)
    allowed = _probe_allowed_auth_methods(host, user, port)
    if verbose:
        if allowed:
            print(f"SSH server offers: {', '.join(allowed)}")
        else:
            print("SSH server offers: (could not detect)")

    methods = _auth_method_order(password, allowed)
    if verbose:
        print(f"SSH auth plan: {', '.join(methods)}")

    errors: list[str] = []
    for method in methods:
        sock = None
        transport = None
        try:
            sock = socket.create_connection((host, port), timeout=25)
            transport = paramiko.Transport(sock)
            transport.connect()
            _try_auth_on_transport(transport, user, password, method)
            if not transport.is_authenticated():
                errors.append(f"{method}: not authenticated after attempt")
                continue

            if verbose:
                print(f"SSH auth OK via {method}")
            client = paramiko.SSHClient()
            client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
            client._transport = transport
            return client, method
        except paramiko.AuthenticationException as exc:
            errors.append(f"{method}: {exc}")
            if verbose:
                print(f"  {method}: rejected ({exc})")
        except paramiko.BadAuthenticationType:
            errors.append(f"{method}: not supported by server")
            if verbose:
                print(f"  {method}: not supported")
        except paramiko.SSHException as exc:
            errors.append(f"{method}: {exc}")
            if verbose:
                print(f"  {method}: {exc}")
        finally:
            if transport is not None and not transport.is_authenticated():
                try:
                    transport.close()
                except Exception:
                    pass
            elif sock is not None and (transport is None or not transport.is_authenticated()):
                try:
                    sock.close()
                except Exception:
                    pass

    detail = "; ".join(errors) if errors else "no auth methods succeeded"
    raise paramiko.AuthenticationException(detail)


def _find_plink() -> str | None:
    for candidate in (
        shutil.which("plink"),
        r"C:\Program Files\PuTTY\plink.exe",
        r"C:\Program Files (x86)\PuTTY\plink.exe",
    ):
        if candidate and Path(candidate).is_file():
            return candidate
    return None


def _find_openssh() -> str | None:
    return shutil.which("ssh")


class _NativeStream:
    def __init__(self, data: bytes):
        self._data = data

    def read(self) -> bytes:
        return self._data


class _NativeChannel:
    def __init__(self, exit_code: int):
        self._exit_code = exit_code

    def recv_exit_status(self) -> int:
        return self._exit_code


class NativeSSHClient:
    """Fallback SSH client via plink or OpenSSH when paramiko auth fails."""

    def __init__(self, host: str, user: str, password: str | None, port: int, backend: str):
        self.host = host
        self.user = user
        self.password = _password_value(password)
        self.port = port
        self.backend = backend
        self._plink = _find_plink() if backend == "plink" else None
        self._ssh = _find_openssh() if backend == "openssh" else None

    def exec_command(self, command: str, timeout: int = 120):
        if self._plink:
            args = [
                self._plink,
                "-batch",
                "-pw",
                self.password,
                "-P",
                str(self.port),
                f"{self.user}@{self.host}",
                command,
            ]
            result = subprocess.run(
                args,
                capture_output=True,
                timeout=timeout,
                check=False,
            )
            return None, _NativeStream(result.stdout), _NativeStream(result.stderr)

        if not self._ssh:
            raise RuntimeError("Native SSH client not found")

        askpass_path = None
        env = os.environ.copy()
        if self.password == "":
            askpass_file = tempfile.NamedTemporaryFile(
                mode="w",
                suffix=".cmd",
                prefix="routerich-askpass-",
                delete=False,
            )
            askpass_file.write("@echo.\r\n")
            askpass_file.close()
            askpass_path = askpass_file.name
            env["SSH_ASKPASS"] = askpass_path
            env["SSH_ASKPASS_REQUIRE"] = "force"
            env["DISPLAY"] = env.get("DISPLAY") or "routerich:0"

        args = [
            self._ssh,
            "-o",
            "StrictHostKeyChecking=accept-new",
            "-o",
            f"UserKnownHostsFile={_known_hosts_path()}",
            "-p",
            str(self.port),
            "-o",
            "PreferredAuthentications=password,keyboard-interactive",
            "-o",
            "PubkeyAuthentication=no",
            f"{self.user}@{self.host}",
            command,
        ]
        try:
            result = subprocess.run(
                args,
                capture_output=True,
                timeout=timeout,
                check=False,
                env=env,
            )
        finally:
            if askpass_path:
                try:
                    os.unlink(askpass_path)
                except OSError:
                    pass

        stdout = _NativeStream(result.stdout)
        stderr = _NativeStream(result.stderr)
        channel = _NativeChannel(result.returncode)
        stdout.channel = channel  # type: ignore[attr-defined]
        return None, stdout, stderr

    def upload_file(self, local: Path, remote: str, mode: str, timeout: int = 120) -> None:
        remote_dir = remote.rsplit("/", 1)[0]
        self.exec_command(f"mkdir -p '{remote_dir}'", timeout=30)

        if self._plink:
            pscp = shutil.which("pscp")
            if not pscp:
                pscp_candidate = Path(self._plink).with_name("pscp.exe")
                pscp = str(pscp_candidate) if pscp_candidate.is_file() else None
            if not pscp:
                raise RuntimeError("pscp not found (required for plink uploads)")
            args = [
                pscp,
                "-batch",
                "-pw",
                self.password,
                "-P",
                str(self.port),
                str(local),
                f"{self.user}@{self.host}:{remote}",
            ]
            result = subprocess.run(args, capture_output=True, timeout=timeout, check=False)
            if result.returncode != 0:
                err = (result.stderr or result.stdout or b"").decode("utf-8", errors="replace").strip()
                raise RuntimeError(f"pscp upload failed: {err or result.returncode}")
        elif self._ssh:
            scp = shutil.which("scp")
            if not scp:
                raise RuntimeError("scp not found (required for native SSH uploads)")
            askpass_path = None
            env = os.environ.copy()
            if self.password == "":
                askpass_file = tempfile.NamedTemporaryFile(
                    mode="w",
                    suffix=".cmd",
                    prefix="routerich-askpass-",
                    delete=False,
                )
                askpass_file.write("@echo.\r\n")
                askpass_file.close()
                askpass_path = askpass_file.name
                env["SSH_ASKPASS"] = askpass_path
                env["SSH_ASKPASS_REQUIRE"] = "force"
                env["DISPLAY"] = env.get("DISPLAY") or "routerich:0"
            args = [
                scp,
                "-o",
                "StrictHostKeyChecking=accept-new",
                "-o",
                f"UserKnownHostsFile={_known_hosts_path()}",
                "-P",
                str(self.port),
                "-o",
                "PreferredAuthentications=password,keyboard-interactive",
                "-o",
                "PubkeyAuthentication=no",
                str(local),
                f"{self.user}@{self.host}:{remote}",
            ]
            try:
                result = subprocess.run(args, capture_output=True, timeout=timeout, check=False, env=env)
            finally:
                if askpass_path:
                    try:
                        os.unlink(askpass_path)
                    except OSError:
                        pass
            if result.returncode != 0:
                err = (result.stderr or result.stdout or b"").decode("utf-8", errors="replace").strip()
                raise RuntimeError(f"scp upload failed: {err or result.returncode}")
        else:
            raise RuntimeError("Native SSH client not configured")

        _, stdout, stderr = self.exec_command(f"chmod {mode} '{remote}'", timeout=15)
        err = stderr.read().decode("utf-8", errors="replace").strip()
        if err:
            raise RuntimeError(f"chmod failed for {remote}: {err}")
        stdout.read()

    def close(self) -> None:
        pass


def _try_native_ssh(
    host: str,
    user: str,
    password: str | None,
    port: int,
    verbose: bool = False,
) -> NativeSSHClient | None:
    pwd = _password_value(password)
    plink = _find_plink()
    if plink:
        if verbose:
            print(f"Trying native SSH via plink ({plink})")
        args = ["-batch", "-pw", pwd, "-P", str(port), f"{user}@{host}", "echo OK"]
        result = subprocess.run([plink, *args], capture_output=True, timeout=30, check=False)
        if result.returncode == 0 and b"OK" in result.stdout:
            if verbose:
                print("Native plink auth OK")
            return NativeSSHClient(host, user, password, port, "plink")
        if verbose:
            err = (result.stderr or result.stdout or b"").decode("utf-8", errors="replace").strip()
            print(f"  plink failed: {err or result.returncode}")

    ssh = _find_openssh()
    if not ssh:
        return None

    if verbose:
        print(f"Trying native SSH via OpenSSH ({ssh})")

    askpass_path = None
    env = os.environ.copy()
    if pwd == "":
        askpass_file = tempfile.NamedTemporaryFile(
            mode="w",
            suffix=".cmd",
            prefix="routerich-askpass-",
            delete=False,
        )
        askpass_file.write("@echo.\r\n")
        askpass_file.close()
        askpass_path = askpass_file.name
        env["SSH_ASKPASS"] = askpass_path
        env["SSH_ASKPASS_REQUIRE"] = "force"
        env["DISPLAY"] = env.get("DISPLAY") or "routerich:0"

    args = [
        ssh,
        "-o",
        "StrictHostKeyChecking=accept-new",
        "-o",
        f"UserKnownHostsFile={_known_hosts_path()}",
        "-p",
        str(port),
        "-o",
        "PreferredAuthentications=password,keyboard-interactive",
        "-o",
        "PubkeyAuthentication=no",
        f"{user}@{host}",
        "echo OK",
    ]
    try:
        result = subprocess.run(args, capture_output=True, timeout=30, check=False, env=env)
    finally:
        if askpass_path:
            try:
                os.unlink(askpass_path)
            except OSError:
                pass

    if result.returncode == 0 and b"OK" in result.stdout:
        if verbose:
            print("Native OpenSSH auth OK")
        return NativeSSHClient(host, user, password, port, "openssh")

    if verbose:
        err = (result.stderr or result.stdout or b"").decode("utf-8", errors="replace").strip()
        print(f"  openssh failed: {err or result.returncode}")
    return None


def connect_ssh(
    host: str,
    user: str,
    password: str | None,
    port: int = 22,
    verbose: bool = False,
) -> "paramiko.SSHClient | NativeSSHClient":
    ensure_ssh_dependencies()
    if paramiko is None:
        raise RuntimeError("paramiko is not installed")

    if not check_tcp_port(host, port):
        raise OSError(f"TCP port {port} is not reachable on {host}")

    if force_remove_known_host(host, port):
        print(f"Cleared old SSH host key for {host} in known_hosts.")

    pwd = _password_value(password)
    if pwd:
        print(f"SSH auth: password provided ({len(pwd)} chars)")
    else:
        print("SSH auth: empty password (none/password-empty/kbd-interactive)")

    last_error: BaseException | None = None
    for host_key_attempt in range(2):
        try:
            client, method = _connect_paramiko_transport(host, user, password, port, verbose=verbose)
            if not verbose:
                print(f"SSH auth OK via {method}")
            return client
        except paramiko.BadHostKeyException as exc:
            last_error = exc
            print(f"SSH host key mismatch (attempt {host_key_attempt + 1}). Clearing known_hosts...")
            force_remove_known_host(host, port)
        except paramiko.AuthenticationException as exc:
            last_error = exc
            break
        except paramiko.SSHException as exc:
            msg = str(exc).lower()
            if "host key" in msg or "known_hosts" in msg:
                force_remove_known_host(host, port)
                last_error = exc
                continue
            last_error = exc
            break
        except OSError as exc:
            last_error = exc
            break

    if pwd == "":
        native = _try_native_ssh(host, user, password, port, verbose=verbose)
        if native is not None:
            print(f"SSH auth OK via native {native.backend}")
            return native

    if isinstance(last_error, paramiko.AuthenticationException):
        hint = f"Authentication failed for {user}@{host}.\n"
        if not pwd:
            hint += (
                "Empty password was rejected by the router.\n"
                "OpenWrt/Dropbear may require a root password — set one in LuCI or use:\n"
                f"  2-*.bat --password YOUR_PASSWORD\n"
                "If the router truly has no password, check Dropbear allows empty passwords.\n"
            )
        else:
            hint += "Check the SSH password.\n"
        hint += f"Details: {last_error}\n"
        hint += f"Test manually: ssh {user}@{host}"
        raise paramiko.AuthenticationException(hint) from last_error

    if last_error:
        raise last_error
    raise paramiko.SSHException(f"SSH connection to {host} failed")


def format_ssh_error(exc: BaseException, host: str) -> str:
    return str(exc)