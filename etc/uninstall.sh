#!/usr/bin/env bash
set -euo pipefail

SERVICE_NAME="relay-chat"

usage() {
  cat <<USAGE
用法: sudo ./etc/uninstall.sh [选项]

选项:
  --service-name NAME   systemd 服务名，默认: relay-chat
  -h, --help            显示帮助

示例:
  sudo ./etc/uninstall.sh
  sudo ./etc/uninstall.sh --service-name relay-chat
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --service-name)
      SERVICE_NAME="${2:-}"; shift 2 ;;
    -h|--help)
      usage; exit 0 ;;
    *)
      echo "未知参数: $1" >&2
      usage >&2
      exit 1 ;;
  esac
done

if [[ -z "${SERVICE_NAME}" ]]; then
  echo "服务名不能为空" >&2
  usage >&2
  exit 1
fi

UNIT_FILE="/etc/systemd/system/${SERVICE_NAME}.service"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "请用 root 运行，例如：sudo ./etc/uninstall.sh" >&2
  exit 1
fi

echo "==> 停止服务：${SERVICE_NAME}.service"
systemctl stop "${SERVICE_NAME}.service" 2>/dev/null || true

echo "==> 禁用服务：${SERVICE_NAME}.service"
systemctl disable "${SERVICE_NAME}.service" 2>/dev/null || true

if [[ -f "${UNIT_FILE}" ]]; then
  echo "==> 删除 systemd unit：${UNIT_FILE}"
  rm -f "${UNIT_FILE}"
fi

systemctl daemon-reload
systemctl reset-failed "${SERVICE_NAME}.service" 2>/dev/null || true

echo "==> 卸载完成"
echo "提示：该脚本不会删除项目目录、.venv、用户级 Python 依赖或浏览器 localStorage 数据。"
