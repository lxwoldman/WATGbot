#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/watgbot}"
BACKUP_DIR="${BACKUP_DIR:-${APP_DIR}/.backups}"
KEEP_COUNT="${KEEP_COUNT:-7}"

mkdir -p "${BACKUP_DIR}"

STAMP="$(date +%Y%m%d-%H%M%S)"
ARCHIVE_PATH="${BACKUP_DIR}/watg-state-${STAMP}.tar.gz"

cd "${APP_DIR}"

tar -czf "${ARCHIVE_PATH}" \
  .env \
  .data \
  .sessions

ls -1dt "${BACKUP_DIR}"/watg-state-*.tar.gz 2>/dev/null | tail -n +"$((KEEP_COUNT + 1))" | xargs -r rm -f

echo "备份完成: ${ARCHIVE_PATH}"
