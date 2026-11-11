#!/usr/bin/env bash
# Arranca AUTORECA IA dentro de GitHub Codespaces (se ejecuta solo al abrir el codespace).
set -e
cd "$(dirname "$0")/.."
KEYFILE=.devcontainer/.encryption-key
[ -f "$KEYFILE" ] || openssl rand -hex 32 > "$KEYFILE"
export APP_ENCRYPTION_KEY="$(cat "$KEYFILE")"
if [ -n "$CODESPACE_NAME" ]; then
  export PUBLIC_URL="https://${CODESPACE_NAME}-3000.${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN:-app.github.dev}"
fi
[ -d server/dist ] && [ -d web/dist ] || npm run build
# Espera a la base de datos
for i in $(seq 1 30); do node -e "new (require('pg').Pool)({connectionString:process.env.DATABASE_URL}).query('select 1').then(()=>process.exit(0)).catch(()=>process.exit(1))" 2>/dev/null && break; sleep 2; done
pkill -f "node dist/index.js" 2>/dev/null || true
cd server
setsid nohup node dist/index.js > /tmp/autoreca.log 2>&1 < /dev/null &
sleep 3
echo "AUTORECA IA arrancada en el puerto ${PORT:-3000} (registro: /tmp/autoreca.log)"
