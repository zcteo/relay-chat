#!/usr/bin/env python3
import os
import shutil
import subprocess
from pathlib import Path


SERVICE_DEFAULT = "relay-chat"
UNIT_DIR = Path("/etc/systemd/system")


def require_root() -> None:
    if os.geteuid() != 0:
        raise SystemExit("请用 root 运行，例如：sudo python3 ~/.local/share/relay-chat/uninstall.py")


def run(cmd: list[str], *, check: bool = True, quiet: bool = False) -> None:
    kwargs = {}
    if quiet:
        kwargs = {"stdout": subprocess.DEVNULL, "stderr": subprocess.DEVNULL}
    subprocess.run(cmd, check=check, **kwargs)


def ask(prompt: str, default: str) -> str:
    value = input(f"{prompt} [{default}]: ").strip()
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


def remove_unit(service_name: str, unit_file: Path) -> None:
    service = f"{service_name}.service"
    print(f"==> 停止服务：{service}")
    run(["systemctl", "stop", service], check=False, quiet=True)
    print(f"==> 禁用服务：{service}")
    run(["systemctl", "disable", service], check=False, quiet=True)
    if unit_file.exists():
        print(f"==> 删除 systemd unit：{unit_file}")
        unit_file.unlink()
    run(["systemctl", "daemon-reload"])
    run(["systemctl", "reset-failed", service], check=False, quiet=True)


def main() -> None:
    require_root()
    install_dir = default_install_dir()
    service_name = read_env(install_dir / ".env").get("SERVICE_NAME", SERVICE_DEFAULT)
    unit_file = UNIT_DIR / f"{service_name}.service"
    install_dir = validate_target(install_dir)

    remove_unit(service_name, unit_file)

    if not install_dir.exists():
        print(f"安装目录不存在：{install_dir}")
        return

    if ask_yes_no("是否删除用户数据并移除整个安装目录", False):
        confirm = input(f"输入 yes 确认删除整个目录 {install_dir}: ").strip()
        if confirm != "yes":
            print("未确认，保留安装目录")
        else:
            shutil.rmtree(install_dir)
            print(f"已删除安装目录：{install_dir}")
    else:
        for name in ("server", "static"):
            target = install_dir / name
            if target.exists():
                shutil.rmtree(target)
                print(f"已删除：{target}")
        print("已保留 .env、data、log、.venv 和 requirements.txt")

    print("==> 卸载完成")


if __name__ == "__main__":
    main()
