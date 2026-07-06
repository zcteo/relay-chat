#!/usr/bin/env python3
import os
import pwd
import secrets
import shutil
import string
import subprocess
from pathlib import Path

from uninstall import ask, ask_yes_no, cleanup_install, read_env, require_root, run


SERVICE_DEFAULT = "relay-chat"
SERVICE_MANAGER_SYSTEMD = "systemd"
SERVICE_MANAGER_OPENWRT = "openwrt"
HOST_DEFAULT = "0.0.0.0"
PORT_DEFAULT = "8000"
PYTHON_BIN = "/usr/bin/python3"
PROJECT_DIR = Path(__file__).resolve().parent.parent
UNIT_DIR = Path("/etc/systemd/system")
INIT_DIR = Path("/etc/init.d")


def create_venv(path: Path) -> None:
    try:
        run([PYTHON_BIN, "-m", "venv", str(path)])
    except subprocess.CalledProcessError as exc:
        raise SystemExit(
            "创建虚拟环境失败，请先安装 Python venv 支持，例如 Debian/Ubuntu："
            "sudo apt install python3-venv；OpenWrt：opkg install python3 python3-pip python3-venv"
        ) from exc


def real_user() -> str:
    return os.environ.get("SUDO_USER") or pwd.getpwuid(os.getuid()).pw_name


def user_home(username: str) -> Path:
    return Path(pwd.getpwnam(username).pw_dir)


def detect_service_manager() -> str:
    if Path("/etc/openwrt_release").exists() or Path("/sbin/procd").exists():
        return SERVICE_MANAGER_OPENWRT
    if shutil.which("systemctl") and Path("/run/systemd/system").exists():
        return SERVICE_MANAGER_SYSTEMD
    raise SystemExit("未检测到支持的服务管理器：需要 systemd 或 OpenWrt procd")


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
    shutil.copytree(
        src,
        dst,
        ignore=shutil.ignore_patterns("__pycache__", "*.pyc", "*.pyo"),
    )


def copy_dir_contents(src: Path, dst: Path) -> None:
    if not src.exists():
        return
    dst.mkdir(parents=True, exist_ok=True)
    shutil.copytree(src, dst, dirs_exist_ok=True)


def migrate_data(old_dir: Path, new_dir: Path, old_env: dict[str, str]) -> None:
    if old_dir == new_dir:
        return
    if old_dir in new_dir.parents:
        raise SystemExit("新安装目录不能位于旧安装目录下")
    old_data = Path(old_env.get("DATA_DIR", old_dir / "data")).expanduser()
    old_log = Path(old_env.get("LOG_PATH", old_dir / "log" / "relay-chat.log")).expanduser().parent
    print(f"==> 迁移数据目录：{old_data} -> {new_dir / 'data'}")
    copy_dir_contents(old_data, new_dir / "data")
    print(f"==> 迁移日志目录：{old_log} -> {new_dir / 'log'}")
    copy_dir_contents(old_log, new_dir / "log")


def prepare_existing_install(
    old_dir: Path | None,
    old_env: dict[str, str],
    new_dir: Path,
    new_service: str,
    new_service_manager: str,
) -> None:
    if not old_dir or not old_env:
        return
    old_service = old_env.get("SERVICE_NAME", SERVICE_DEFAULT)
    old_service_manager = old_env.get("SERVICE_MANAGER", SERVICE_MANAGER_SYSTEMD)
    service_changed = old_service != new_service
    service_manager_changed = old_service_manager != new_service_manager
    path_changed = old_dir != new_dir
    if not service_changed and not service_manager_changed and not path_changed:
        return

    if service_changed and not ask_yes_no(
        f"检测到服务名变化：{old_service} -> {new_service}，是否允许安装脚本自动停止并删除旧服务",
        True,
    ):
        raise SystemExit("已取消安装")

    migrate_old_data = False
    if path_changed:
        migrate_old_data = ask_yes_no(
            f"检测到安装路径变化：{old_dir} -> {new_dir}，是否迁移旧数据",
            True,
        )

    if path_changed and migrate_old_data:
        new_dir.mkdir(parents=True, exist_ok=True)
        migrate_data(old_dir, new_dir, old_env)
        cleanup_install(
            old_dir,
            old_service,
            remove_data=True,
            service_manager=old_service_manager,
        )
    elif path_changed:
        cleanup_install(
            old_dir,
            old_service,
            remove_data=True,
            service_manager=old_service_manager,
        )
    else:
        cleanup_install(
            old_dir,
            old_service,
            remove_data=False,
            service_manager=old_service_manager,
        )


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


def write_systemd_service(
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


def enable_systemd_service(service_name: str, restart_service: bool) -> None:
    run(["systemctl", "daemon-reload"])
    run(["systemctl", "enable", f"{service_name}.service"])
    if restart_service:
        run(["systemctl", "restart", f"{service_name}.service"])


def write_openwrt_service(
    service_name: str,
    run_user: str,
    install_dir: Path,
) -> Path:
    init_file = INIT_DIR / service_name
    exec_python = install_dir / ".venv/bin/python"
    content = f"""#!/bin/sh /etc/rc.common
START=95
STOP=10
USE_PROCD=1

INSTALL_DIR="{install_dir}"
RUN_USER="{run_user}"

start_service() {{
    . "$INSTALL_DIR/.env"

    procd_open_instance
    procd_set_param command /bin/sh -c "cd '$INSTALL_DIR' && exec '{exec_python}' -m uvicorn server.main:app --host '$HOST' --port '$PORT'"
    procd_set_param user "$RUN_USER"
    procd_set_param env PYTHONUNBUFFERED=1
    procd_set_param respawn 3600 5 5
    procd_set_param stdout 1
    procd_set_param stderr 1
    procd_close_instance
}}
"""
    init_file.write_text(content, encoding="utf-8")
    init_file.chmod(0o755)
    return init_file


def enable_openwrt_service(service_name: str, restart_service: bool) -> None:
    init_file = INIT_DIR / service_name
    run([str(init_file), "enable"])
    if restart_service:
        run([str(init_file), "restart"])


def main() -> None:
    require_root("sudo python3 scripts/install.py")
    if not (PROJECT_DIR / "server/main.py").exists():
        raise SystemExit("源码目录缺少 server/main.py")

    service_manager = detect_service_manager()
    print(f"==> 检测到服务管理器：{service_manager}")

    default_user = real_user()
    run_user = ask("运行用户", default_user)
    try:
        home_dir = user_home(run_user)
    except KeyError as exc:
        raise SystemExit(f"运行用户不存在：{run_user}") from exc

    default_install = Path("/opt/relay-chat").resolve()
    legacy_install = (home_dir / ".local/share/relay-chat").resolve()
    default_env = read_env(default_install / ".env")
    legacy_env = {} if legacy_install == default_install else read_env(legacy_install / ".env")
    base_env = default_env or legacy_env
    service_name = ask("服务名", base_env.get("SERVICE_NAME", SERVICE_DEFAULT))
    install_dir = validate_install_dir(Path(ask("安装目录", str(default_install))))
    env_path = install_dir / ".env"
    target_env = read_env(env_path)
    if target_env:
        existing_install_dir = install_dir
        old_env = target_env
    elif default_env:
        existing_install_dir = default_install
        old_env = default_env
    elif legacy_env:
        existing_install_dir = legacy_install
        old_env = legacy_env
    else:
        existing_install_dir = None
        old_env = {}

    prepare_existing_install(
        existing_install_dir,
        old_env,
        install_dir,
        service_name,
        service_manager,
    )

    host = ask("监听地址", old_env.get("HOST", HOST_DEFAULT))
    port = ask("监听端口", old_env.get("PORT", PORT_DEFAULT))
    validate_port(port)
    access_code = ask("访问码", old_env.get("ACCESS_CODE", random_code()), allow_empty=True)
    registration_code = ask(
        "注册码",
        old_env.get("REGISTRATION_CODE", random_code()),
        allow_empty=True,
    )
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
        "SERVICE_MANAGER": service_manager,
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

    if service_manager == SERVICE_MANAGER_OPENWRT:
        print("==> 写入 OpenWrt init 脚本")
        service_file = write_openwrt_service(service_name, run_user, install_dir)
        enable_openwrt_service(service_name, restart_service)
        service_label = service_name
        log_hint = f"logread -f | grep {service_name}"
    else:
        print("==> 写入 systemd unit")
        service_file = write_systemd_service(service_name, run_user, home_dir, install_dir, host, port)
        enable_systemd_service(service_name, restart_service)
        service_label = f"{service_name}.service"
        log_hint = f"journalctl -u {service_name}.service -f"

    print("==> 安装完成")
    print(f"服务管理器：{service_manager}")
    print(f"服务：{service_label}")
    print(f"安装目录：{install_dir}")
    print(f"配置文件：{env_path}")
    print(f"服务文件：{service_file}")
    print(f"访问地址：{display_url(host, port)}")
    print(f"访问码：{access_code}")
    print(f"注册码：{registration_code}")
    print(f"查看日志：{log_hint}")


if __name__ == "__main__":
    main()
