#!/usr/bin/env python3
import os
import pwd
import shutil
import subprocess
from pathlib import Path


SERVICE_DEFAULT = "relay-chat"
SERVICE_MANAGER_DEFAULT = "systemd"
UNIT_DIR = Path("/etc/systemd/system")
INIT_DIR = Path("/etc/init.d")


def require_root(usage: str = "sudo python3 /opt/relay-chat/uninstall.py") -> None:
    if os.geteuid() != 0:
        raise SystemExit(f"请用 root 运行，例如：{usage}")


def run(
    cmd: list[str],
    *,
    user: str | None = None,
    check: bool = True,
    quiet: bool = False,
) -> None:
    if user:
        current_user = pwd.getpwuid(os.geteuid()).pw_name
        if user == current_user:
            pass
        elif shutil.which("sudo"):
            cmd = ["sudo", "-H", "-u", user, *cmd]
        elif shutil.which("runuser"):
            cmd = ["runuser", "-u", user, "--", *cmd]
        else:
            raise SystemExit(f"缺少 sudo 或 runuser，无法以用户 {user} 执行命令")
    kwargs = {}
    if quiet:
        kwargs = {"stdout": subprocess.DEVNULL, "stderr": subprocess.DEVNULL}
    subprocess.run(cmd, check=check, **kwargs)


def ask(prompt: str, default: str, *, allow_empty: bool = False) -> str:
    suffix = f"{prompt} [{default}]"
    if allow_empty:
        suffix += "，输入空格表示空"
    raw = input(f"{suffix}: ")
    if allow_empty and raw and raw.strip() == "":
        return ""
    value = raw.strip()
    return value or default


def ask_yes_no(prompt: str, default: bool = False) -> bool:
    suffix = "Y/n" if default else "y/N"
    value = input(f"{prompt} [{suffix}]: ").strip().lower()
    if not value:
        return default
    return value in {"y", "yes", "是"}


def default_install_dir() -> Path:
    return Path(__file__).resolve().parent


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


def validate_target(path: Path) -> Path:
    target = path.expanduser().resolve()
    dangerous = {Path("/"), Path("/home"), Path("/root")}
    if target in dangerous or str(target) == "":
        raise SystemExit(f"拒绝删除高风险目录：{target}")
    return target


def normalize_service_manager(value: str | None) -> str:
    manager = (value or SERVICE_MANAGER_DEFAULT).strip().lower()
    if manager not in {"systemd", "openwrt"}:
        print(f"未知服务管理器：{manager}，按 systemd 处理")
        return SERVICE_MANAGER_DEFAULT
    return manager


def remove_systemd_service(service_name: str, unit_file: Path | None = None) -> None:
    service = f"{service_name}.service"
    unit_file = unit_file or UNIT_DIR / service
    print(f"==> 停止服务：{service}")
    run(["systemctl", "stop", service], check=False, quiet=True)
    print(f"==> 禁用服务：{service}")
    run(["systemctl", "disable", service], check=False, quiet=True)
    if unit_file.exists():
        print(f"==> 删除 systemd unit：{unit_file}")
        unit_file.unlink()
    run(["systemctl", "daemon-reload"])
    run(["systemctl", "reset-failed", service], check=False, quiet=True)


def remove_openwrt_service(service_name: str, init_file: Path | None = None) -> None:
    init_file = init_file or INIT_DIR / service_name
    print(f"==> 停止服务：{service_name}")
    if init_file.exists():
        run([str(init_file), "stop"], check=False, quiet=True)
        print(f"==> 禁用服务：{service_name}")
        run([str(init_file), "disable"], check=False, quiet=True)
        print(f"==> 删除 OpenWrt init 脚本：{init_file}")
        init_file.unlink()
    else:
        print(f"OpenWrt init 脚本不存在：{init_file}")


def remove_service(service_name: str, service_manager: str) -> None:
    manager = normalize_service_manager(service_manager)
    if manager == "openwrt":
        remove_openwrt_service(service_name)
        return
    remove_systemd_service(service_name)


def remove_runtime_dirs(install_dir: Path) -> None:
    for name in ("server", "static"):
        target = install_dir / name
        if target.exists():
            shutil.rmtree(target)
            print(f"已删除：{target}")


def cleanup_install(
    install_dir: Path,
    service_name: str,
    *,
    remove_data: bool,
    service_manager: str = SERVICE_MANAGER_DEFAULT,
) -> None:
    install_dir = validate_target(install_dir)
    remove_service(service_name, service_manager)
    if not install_dir.exists():
        print(f"安装目录不存在：{install_dir}")
        return
    if remove_data:
        shutil.rmtree(install_dir)
        print(f"已删除安装目录：{install_dir}")
        return
    remove_runtime_dirs(install_dir)
    print("已保留 .env、data、log、.venv 和 requirements.txt")


def main() -> None:
    require_root()
    install_dir = default_install_dir()
    env = read_env(install_dir / ".env")
    service_name = SERVICE_DEFAULT
    service_manager = env.get("SERVICE_MANAGER", SERVICE_MANAGER_DEFAULT)

    if ask_yes_no("是否删除用户数据并移除整个安装目录", False):
        confirm = input(f"输入 yes 确认删除整个目录 {install_dir}: ").strip()
        if confirm != "yes":
            print("未确认，保留安装目录")
        else:
            cleanup_install(
                install_dir,
                service_name,
                remove_data=True,
                service_manager=service_manager,
            )
    else:
        cleanup_install(
            install_dir,
            service_name,
            remove_data=False,
            service_manager=service_manager,
        )

    print("==> 卸载完成")


if __name__ == "__main__":
    main()
