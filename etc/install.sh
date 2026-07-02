#!/usr/bin/env bash
set -euo pipefail

SERVICE_NAME="relay-chat"
HOST="0.0.0.0"
PORT="8000"
RUN_USER="${SUDO_USER:-$(id -un)}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
PYTHON_BIN="/usr/bin/python3"

usage() {
  cat <<USAGE
用法: sudo ./etc/install.sh [选项]

选项:
  --service-name NAME   systemd 服务名，默认: relay-chat
  --host HOST           监听地址，默认: 0.0.0.0
  --port PORT           监听端口，默认: 8000
  --user USER           运行用户，默认: 当前用户；sudo 时为 sudo 调用用户
  -h, --help            显示帮助

示例:
  sudo ./etc/install.sh
  sudo ./etc/install.sh --host 127.0.0.1 --port 8000 --user zzc
  sudo ./etc/install.sh --service-name relay-chat --host 127.0.0.1 --port 8000 --user zzc
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --service-name)
      SERVICE_NAME="${2:-}"; shift 2 ;;
    --host)
      HOST="${2:-}"; shift 2 ;;
    --port)
      PORT="${2:-}"; shift 2 ;;
    --user)
      RUN_USER="${2:-}"; shift 2 ;;
    -h|--help)
      usage; exit 0 ;;
    *)
      echo "未知参数: $1" >&2
      usage >&2
      exit 1 ;;
  esac
done

if [[ -z "${SERVICE_NAME}" || -z "${HOST}" || -z "${PORT}" || -z "${RUN_USER}" ]]; then
  echo "参数不能为空" >&2
  usage >&2
  exit 1
fi

UNIT_FILE="/etc/systemd/system/${SERVICE_NAME}.service"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "请用 root 运行，例如：sudo ./etc/install.sh" >&2
  exit 1
fi

if ! [[ "${PORT}" =~ ^[0-9]+$ ]] || (( PORT < 1 || PORT > 65535 )); then
  echo "端口无效：${PORT}" >&2
  exit 1
fi

if ! id "${RUN_USER}" >/dev/null 2>&1; then
  echo "运行用户不存在：${RUN_USER}" >&2
  exit 1
fi

if [[ ! -f "${APP_DIR}/src/main.py" || ! -f "${APP_DIR}/requirements.txt" ]]; then
  echo "项目目录缺少 src/main.py 或 requirements.txt" >&2
  exit 1
fi

HOME_DIR="$(getent passwd "${RUN_USER}" | cut -d: -f6)"
if [[ -z "${HOME_DIR}" || ! -d "${HOME_DIR}" ]]; then
  echo "无法确定用户 ${RUN_USER} 的 HOME 目录" >&2
  exit 1
fi

run_as_user() {
  if command -v sudo >/dev/null 2>&1; then
    sudo -H -u "${RUN_USER}" "$@"
  else
    runuser -u "${RUN_USER}" -- "$@"
  fi
}

echo "==> 应用目录：${APP_DIR}"
echo "==> 服务名称：${SERVICE_NAME}"
echo "==> 运行用户：${RUN_USER}"
echo "==> 监听地址：${HOST}:${PORT}"

if "${PYTHON_BIN}" -m venv "${APP_DIR}/.venv" >/tmp/${SERVICE_NAME}-venv.log 2>&1; then
  echo "==> 使用虚拟环境安装依赖"
  chown -R "${RUN_USER}:${RUN_USER}" "${APP_DIR}/.venv"
  run_as_user "${APP_DIR}/.venv/bin/python" -m pip install --upgrade pip
  run_as_user "${APP_DIR}/.venv/bin/python" -m pip install -r "${APP_DIR}/requirements.txt"
  EXEC_PYTHON="${APP_DIR}/.venv/bin/python"
else
  echo "==> 创建虚拟环境失败，回退到用户级 pip 安装"
  cat /tmp/${SERVICE_NAME}-venv.log || true
  if ! "${PYTHON_BIN}" -m pip --version >/dev/null 2>&1; then
    echo "系统没有 pip，请先安装 python3-pip 或 python3-venv" >&2
    exit 1
  fi
  if run_as_user "${PYTHON_BIN}" -m pip install --user -r "${APP_DIR}/requirements.txt"; then
    true
  else
    echo "==> 普通 --user 安装失败，尝试 Debian/Ubuntu PEP668 兼容参数 --break-system-packages"
    run_as_user "${PYTHON_BIN}" -m pip install --user --break-system-packages -r "${APP_DIR}/requirements.txt"
  fi
  EXEC_PYTHON="${PYTHON_BIN}"
fi

echo "==> 写入 systemd unit：${UNIT_FILE}"
cat > "${UNIT_FILE}" <<UNIT
[Unit]
Description=RelayChat FastAPI Service
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${RUN_USER}
WorkingDirectory=${APP_DIR}
Environment=PYTHONUNBUFFERED=1
Environment=PATH=${HOME_DIR}/.local/bin:/usr/local/bin:/usr/bin:/bin
ExecStart=${EXEC_PYTHON} -m uvicorn src.main:app --host ${HOST} --port ${PORT}
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable "${SERVICE_NAME}.service"
systemctl restart "${SERVICE_NAME}.service"

echo "==> 安装完成"
echo "服务状态：systemctl status ${SERVICE_NAME}.service"
echo "查看日志：journalctl -u ${SERVICE_NAME}.service -f"
echo "访问地址：http://${HOST}:${PORT}"
