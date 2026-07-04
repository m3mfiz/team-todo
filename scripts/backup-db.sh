#!/usr/bin/env bash
# Nightly SQLite backup: VACUUM INTO via better-sqlite3 (no sqlite3 CLI on the prod host).
# Cron (prod): 40 3 * * * /home/m3mfis/team-todo/scripts/backup-db.sh >> /home/m3mfis/backups/team-todo-backup.log 2>&1
set -euo pipefail

BACKUP_DIR="$HOME/backups"
APP_DIR="$HOME/team-todo"
OUT="$BACKUP_DIR/team-todo-$(date +%Y%m%d-%H%M%S).db"

mkdir -p "$BACKUP_DIR"
cd "$APP_DIR"
DB_SRC="$APP_DIR/data/team-todo.db" DB_OUT="$OUT" node -e '
const Database = require("better-sqlite3");
const db = new Database(process.env.DB_SRC, { readonly: true, fileMustExist: true });
db.exec(`VACUUM INTO '\''${process.env.DB_OUT}'\''`);
db.close();
'
# retention: keep the newest 14 backups
ls -1t "$BACKUP_DIR"/team-todo-*.db 2>/dev/null | tail -n +15 | xargs -r rm --
echo "backup ok: $OUT ($(du -h "$OUT" | cut -f1))"
