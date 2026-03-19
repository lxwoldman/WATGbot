#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "请用 sudo 运行此脚本。"
  exit 1
fi

APP_DIR="${APP_DIR:-/opt/watgbot}"
APP_USER="${APP_USER:-ubuntu}"

echo "[1/5] 安装系统依赖..."
apt-get update
apt-get install -y \
  ca-certificates \
  curl \
  git \
  jq \
  unzip \
  xz-utils \
  build-essential \
  python3 \
  fonts-liberation \
  libasound2 \
  libatk-bridge2.0-0 \
  libatk1.0-0 \
  libc6 \
  libcairo2 \
  libcups2 \
  libdbus-1-3 \
  libdrm2 \
  libexpat1 \
  libfontconfig1 \
  libgbm1 \
  libgcc-s1 \
  libglib2.0-0 \
  libgtk-3-0 \
  libnspr4 \
  libnss3 \
  libpango-1.0-0 \
  libpangocairo-1.0-0 \
  libstdc++6 \
  libx11-6 \
  libx11-xcb1 \
  libxcb1 \
  libxcomposite1 \
  libxdamage1 \
  libxext6 \
  libxfixes3 \
  libxrandr2 \
  xdg-utils

if ! command -v node >/dev/null 2>&1 || ! node -e "process.exit(Number(process.versions.node.split('.')[0]) >= 20 ? 0 : 1)"; then
  echo "[2/5] 安装 Node.js 20..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
else
  echo "[2/5] Node.js 已满足要求，跳过安装。"
fi

if ! command -v tailscale >/dev/null 2>&1; then
  echo "[3/5] 安装 Tailscale..."
  curl -fsSL https://tailscale.com/install.sh | sh
else
  echo "[3/5] Tailscale 已安装，跳过。"
fi

echo "[4/5] 准备应用目录..."
mkdir -p "${APP_DIR}" "${APP_DIR}/.data" "${APP_DIR}/.sessions" "${APP_DIR}/.backups"
cd "${APP_DIR}"

if [[ ! -f package.json ]]; then
  echo "未在 ${APP_DIR} 发现 package.json，请先把项目代码放到该目录。"
  exit 1
fi

if [[ -f package-lock.json ]]; then
  npm ci --omit=dev
else
  npm install --omit=dev
fi

echo "[5/5] 修正目录权限..."
chown -R "${APP_USER}:${APP_USER}" "${APP_DIR}"

cat <<EOF

系统依赖安装完成。

下一步：
1. 复制环境变量模板
   cp deploy/.env.production.example .env
2. 填好 .env 里的真实参数
3. 复制 systemd 服务文件
   sudo cp deploy/ubuntu/watg-console.service /etc/systemd/system/watg-console.service
4. 启动服务
   sudo systemctl daemon-reload
   sudo systemctl enable --now watg-console
5. 加入 Tailscale 私网
   sudo tailscale up

EOF
