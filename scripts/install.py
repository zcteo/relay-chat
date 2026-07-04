#!/usr/bin/env python3
import os
import pwd
import secrets
import shutil
import string
import subprocess
from pathlib import Path


SERVICE_DEFAULT = "relay-chat"
HOST_DEFAULT = "0.0.0.0"
PORT_DEFAULT = "8000"
PYTHON_BIN = "/usr/bin/python3"
PROJECT_DIR = Path(__file__).resolve().parent.parent
UNIT_DIR = Path("/etc/systemd/system")


def require_root() -> None:
    if os.geteuid() != 0:
        raise SystemExit("请用 root 运行，例如：sudo python3 scripts/install.py")


def run(cmd: list[str], *, user: str | None = None) -> None:
    if user:
        if shutil.which("sudo"):
            cmd = ["sudo", "-H", "-u", user, *cmd]
        else:
            cmd = ["runuser", "-u", user, "--", *cmd]
    subprocess.run(cmd, check=True)


def create_venv(path: Path) -> None:
    try:
        run([PYTHON_BIN, "-m", "venv", str(path)])
    except subprocess.CalledProcessError as exc:
        raise SystemExit(
            "创建虚拟环境失败，请先安装 python3-venv，例如：sudo apt install python3-venv"
        ) from exc


def ask(prompt: str, default: str) -> str:
    value = input(f"{prompt} [{default}]: ").strip()
    return value or default


def ask_yes_no(prompt: str, default: bool = True) -> bool:
    suffix = "Y/n" if default else "y/N"
    value = input(f"{prompt} [{suffix}]: ").strip().lower()
    if not value:
        return default
    return value in {"y", "yes", "是"}


def real_user() -> str:
    return os.environ.get("SUDO_USER") or pwd.getpwuid(os.getuid()).pw_name


def user_home(username: str) -> Path:
    return Path(pwd.getpwnam(username).pw_dir)


def read_env(path: Path) -> dict[str, str]:
    data: dict[str, str] = {}
    if not path.exists():
        return data
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        data[key.strip()] = value.strip().strip("\"'")
    return data


def write_env(path: Path, values: dict[str, str]) -> None:
    lines = [f"{key}={value}" for key, value in values.items()]
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    path.chmod(0o600)


def random_code() -> str:
    alphabet = string.ascii_letters + string.digits
    return "".join(secrets.choice(alphabet) for _ in range(24))


def validate_port(port: str) -> None:
    if not port.isdigit() or not (1 <= int(port) <= 65535):
        raise SystemExit(f"端口无效：{port}")


def validate_install_dir(install_dir: Path) -> Path:
    source = PROJECT_DIR.resolve()
    target = install_dir.expanduser().resolve()
    if target == source:
        raise SystemExit("安装目录不能等于源码目录")
    if source in target.parents:
        raise SystemExit("安装目录不能位于源码目录下")
    if target in source.parents:
        raise SystemExit("源码目录不能位于安装目录下")
    return target


def copy_tree(src: Path, dst: Path) -> None:
    if dst.exists():
        shutil.rmtree(dst)
    shutil.copytree(src, dst)


def display_url(host: str, port: str) -> str:
    shown_host = "127.0.0.1" if host == "0.0.0.0" else host
    suffix = "" if port == "80" else f":{port}"
    return f"http://{shown_host}{suffix}"


def chown_tree(path: Path, username: str) -> None:
    info = pwd.getpwnam(username)
    for root, dirs, files in os.walk(path):
        os.chown(root, info.pw_uid, info.pw_gid)
        for name in dirs:
            os.chown(Path(root) / name, info.pw_uid, info.pw_gid)
        for name in files:
            os.chown(Path(root) / name, info.pw_uid, info.pw_gid)


def write_unit(
    service_name: str,
    run_user: str,
    home_dir: Path,
    install_dir: Path,
    host: str,
    port: str,
) -> Path:
    unit_file = UNIT_DIR / f"{service_name}.service"
    exec_python = install_dir / ".venv/bin/python"
    content = f"""[Unit]
Description=RelayChat FastAPI Service
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User={run_user}
WorkingDirectory={install_dir}
Environment=PYTHONUNBUFFERED=1
Environment=PATH={home_dir}/.local/bin:/usr/local/bin:/usr/bin:/bin
EnvironmentFile={install_dir}/.env
ExecStart={exec_python} -m uvicorn server.main:app --host {host} --port {port}
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
"""
    unit_file.write_text(content, encoding="utf-8")
    return unit_file


def main() -> None:
    require_root()
    if not (PROJECT_DIR / "server/main.py").exists():
        raise SystemExit("源码目录缺少 server/main.py")

    default_user = real_user()
    run_user = ask("运行用户", default_user)
    try:
        home_dir = user_home(run_user)
    except KeyError as exc:
        raise SystemExit(f"运行用户不存在：{run_user}") from exc

    default_install = home_dir / ".local/share/relay-chat"
    default_env = read_env(default_install / ".env")
    service_name = ask("服务名", default_env.get("SERVICE_NAME", SERVICE_DEFAULT))
    install_dir = validate_install_dir(Path(ask("安装目录", str(default_install))))
    env_path = install_dir / ".env"
    old_env = read_env(env_path)
    if old_env.get("SERVICE_NAME") and old_env["SERVICE_NAME"] != service_name:
        service_name = ask("服务名", old_env.get("SERVICE_NAME", service_name))

    host = ask("监听地址", old_env.get("HOST", HOST_DEFAULT))
    port = ask("监听端口", old_env.get("PORT", PORT_DEFAULT))
    validate_port(port)
    access_code = ask("访问码", old_env.get("ACCESS_CODE", random_code()))
    registration_code = ask("注册码", old_env.get("REGISTRATION_CODE", random_code()))
    install_deps = ask_yes_no("安装/更新 Python 依赖", True)
    restart_service = ask_yes_no("启动/重启服务", True)

    data_dir = install_dir / "data"
    log_dir = install_dir / "log"
    install_dir.mkdir(parents=True, exist_ok=True)
    data_dir.mkdir(parents=True, exist_ok=True)
    log_dir.mkdir(parents=True, exist_ok=True)

    venv_dir = install_dir / ".venv"
    if not venv_dir.exists():
        print("==> 创建虚拟环境")
        create_venv(venv_dir)
    chown_tree(venv_dir, run_user)
    shutil.copy2(PROJECT_DIR / "requirements.txt", install_dir / "requirements.txt")
    if install_deps:
        print("==> 安装 Python 依赖")
        run([str(venv_dir / "bin/python"), "-m", "pip", "install", "--upgrade", "pip"], user=run_user)
        run([str(venv_dir / "bin/python"), "-m", "pip", "install", "-r", str(install_dir / "requirements.txt")], user=run_user)

    print(f"==> 安装目录：{install_dir}")
    print("==> 复制后端文件")
    copy_tree(PROJECT_DIR / "server", install_dir / "server")
    print("==> 复制静态文件")
    copy_tree(PROJECT_DIR / "static", install_dir / "static")
    shutil.copy2(PROJECT_DIR / "scripts/uninstall.py", install_dir / "uninstall.py")
    (install_dir / "uninstall.py").chmod(0o755)

    env_values = {
        "SERVICE_NAME": service_name,
        "HOST": host,
        "PORT": port,
        "DATA_DIR": str(data_dir),
        "DB_PATH": str(data_dir / "relay-chat.sqlite3"),
        "LOG_PATH": str(log_dir / "relay-chat.log"),
        "ACCESS_CODE": access_code,
        "REGISTRATION_CODE": registration_code,
        "LOGIN_TOKEN_DAYS": old_env.get("LOGIN_TOKEN_DAYS", "7"),
    }
    write_env(env_path, env_values)

    chown_tree(install_dir, run_user)

    print("==> 写入 systemd unit")
    unit_file = write_unit(service_name, run_user, home_dir, install_dir, host, port)
    run(["systemctl", "daemon-reload"])
    run(["systemctl", "enable", f"{service_name}.service"])
    if restart_service:
        run(["systemctl", "restart", f"{service_name}.service"])

    print("==> 安装完成")
    print(f"服务：{service_name}.service")
    print(f"安装目录：{install_dir}")
    print(f"配置文件：{env_path}")
    print(f"systemd unit：{unit_file}")
    print(f"访问地址：{display_url(host, port)}")
    print(f"访问码：{access_code}")
    print(f"注册码：{registration_code}")
    print(f"查看日志：journalctl -u {service_name}.service -f")


if __name__ == "__main__":
    main()
