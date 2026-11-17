#!/usr/bin/env bash
# Starts the full local backend and exposes the API through an ngrok tunnel
# so a phone (APK) can reach it. Works on macOS (bash 3.2) and Linux/WSL.
#
#   ./scripts/dev-tunnel.sh              # docker services + API + ngrok
#   USE_LOCAL_SERVICES=1 ./scripts/...   # use already-running Postgres/Redis
#   NO_TUNNEL=1 ./scripts/...            # skip ngrok (same Wi-Fi testing)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
API_PORT="${API_PORT:-3000}"
CRED_FILE="$ROOT/.dev-credentials"

say() { printf '\033[1;32m==>\033[0m %s\n' "$*"; }
die() { printf '\033[1;31mERROR:\033[0m %s\n' "$*" >&2; exit 1; }

command -v pnpm >/dev/null || die "pnpm is missing: npm install -g pnpm"
command -v openssl >/dev/null || die "openssl is missing"
node -e 'process.exit(+process.versions.node.split(".")[0] >= 22 ? 0 : 1)' \
  || die "Node.js 22+ is required (current: $(node -v))"
if [ "${NO_TUNNEL:-0}" != "1" ]; then
  command -v ngrok >/dev/null || die "ngrok is missing: brew install ngrok (then: ngrok config add-authtoken <token>)"
fi

# --- 1. Environment files (created once, never overwritten) ---------------
if [ ! -f packages/database/.env ]; then
  say "Creating packages/database/.env with fresh JWT secrets"
  cat > packages/database/.env <<EOF
DATABASE_URL=postgresql://privateride:privateride_dev@localhost:5432/privateride
REDIS_URL=redis://localhost:6379
API_PORT=$API_PORT
NODE_ENV=development
JWT_ACCESS_SECRET=$(openssl rand -hex 32)
JWT_REFRESH_SECRET=$(openssl rand -hex 32)
JWT_ACCESS_TTL=900
JWT_REFRESH_TTL=2592000
PAYMENT_PROVIDER=sandbox
MAPS_PROVIDER=stub
TRUST_PROXY=1
EOF
fi
cp packages/database/.env apps/api/.env

# --- 2. Postgres + Redis ---------------------------------------------------
if [ "${USE_LOCAL_SERVICES:-0}" != "1" ]; then
  command -v docker >/dev/null || die "Docker is missing (install Docker Desktop) or set USE_LOCAL_SERVICES=1"
  say "Starting Postgres (PostGIS) and Redis in Docker"
  docker compose -f docker/docker-compose.yml up -d
  printf 'Waiting for Postgres'
  for _ in $(seq 1 60); do
    if docker compose -f docker/docker-compose.yml exec -T postgres pg_isready -U privateride >/dev/null 2>&1; then
      echo " ready"; break
    fi
    printf '.'; sleep 1
  done
fi

# --- 3. Install, build, migrate, seed -------------------------------------
say "Installing dependencies"
pnpm install --frozen-lockfile >/dev/null
say "Building shared packages and API"
# The Prisma client must exist before the database package compiles.
pnpm --filter @privateride/database exec prisma generate >/dev/null
pnpm --filter @privateride/shared --filter @privateride/validation --filter @privateride/database build >/dev/null
pnpm --filter @privateride/api build >/dev/null
say "Applying database migrations"
( set -a; . packages/database/.env; set +a
  pnpm --filter @privateride/database exec prisma migrate deploy >/dev/null )

# The admin password is generated once and kept in a git-ignored file. The
# public repository's default password must never guard an internet-facing API.
if [ ! -f "$CRED_FILE" ]; then
  ADMIN_PASSWORD="$(openssl rand -base64 18 | tr -d '/+=')Aa1"
  printf 'SEED_ADMIN_EMAIL=admin@privateride.local\nSEED_ADMIN_PASSWORD=%s\n' "$ADMIN_PASSWORD" > "$CRED_FILE"
  chmod 600 "$CRED_FILE"
fi
say "Seeding roles, community, pricing and admin account"
( set -a; . packages/database/.env; . "$CRED_FILE"; set +a
  pnpm --filter @privateride/database seed 2>/dev/null | grep -E 'Seed|invitation' || true )

# --- 4. API ----------------------------------------------------------------
if curl -s -m 2 "http://localhost:$API_PORT/v1/health" >/dev/null 2>&1; then
  die "Port $API_PORT is already in use. Stop the other process first."
fi
say "Starting API on :$API_PORT (log: .api.log)"
( cd apps/api; set -a; . ./.env; set +a; exec node dist/main.js ) > .api.log 2>&1 &
API_PID=$!
cleanup() { kill "$API_PID" ${NGROK_PID:-} 2>/dev/null || true; }
trap cleanup EXIT INT TERM

for _ in $(seq 1 30); do
  curl -s -m 2 "http://localhost:$API_PORT/v1/health" | grep -q '"ok"' && break
  sleep 1
done
curl -s -m 2 "http://localhost:$API_PORT/v1/health" | grep -q '"ok"' \
  || { tail -20 .api.log; die "API did not become healthy"; }
say "API healthy"

# --- 5. Tunnel -------------------------------------------------------------
PUBLIC_URL=""
if [ "${NO_TUNNEL:-0}" != "1" ]; then
  say "Opening ngrok tunnel"
  ngrok http "$API_PORT" --log=stdout > .ngrok.log 2>&1 &
  NGROK_PID=$!
  for _ in $(seq 1 20); do
    PUBLIC_URL="$(curl -s http://127.0.0.1:4040/api/tunnels 2>/dev/null \
      | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{const t=JSON.parse(d).tunnels.find(x=>x.public_url.startsWith("https"));process.stdout.write(t?t.public_url:"")}catch{}})')"
    [ -n "$PUBLIC_URL" ] && break
    sleep 1
  done
  [ -n "$PUBLIC_URL" ] || { tail -20 .ngrok.log; die "ngrok did not start (did you run: ngrok config add-authtoken <token>?)"; }
fi

LAN_IP="$( (ipconfig getifaddr en0 || hostname -I | awk '{print $1}') 2>/dev/null || true)"

echo
echo "────────────────────────────────────────────────────────────"
[ -n "$PUBLIC_URL" ] && echo "  Server address for the phone:  $PUBLIC_URL"
[ -n "$LAN_IP" ] && echo "  Same Wi-Fi alternative:        http://$LAN_IP:$API_PORT"
echo "  Admin login:                   see $CRED_FILE"
echo "  API log:                       .api.log"
echo "────────────────────────────────────────────────────────────"
echo "  On the phone: login screen → ⚙︎ Сървър → paste the address"
echo "  Press Ctrl+C to stop everything."
echo
wait "$API_PID"
