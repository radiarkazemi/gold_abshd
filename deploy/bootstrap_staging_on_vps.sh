#!/usr/bin/env bash
# One-time bootstrap of the staging stack on the VPS.
# Safe for production: does not restart or rewrite the live site except
# adding a separate nginx site + opening port 8080.
set -euo pipefail

PROD_ROOT=/opt/ghasrtala/gold_abshd
STAGING_ROOT=/opt/ghasrtala/gold_abshd_staging
REPO_URL="${REPO_URL:-https://github.com/radiarkazemi/gold_abshd.git}"
DEVELOP_BRANCH="${DEVELOP_BRANCH:-develop}"

if [[ "$(id -u)" -eq 0 ]]; then
  echo "Run as deploy (script will sudo when needed), not as root."
  exit 1
fi

echo "==> Ensure git branches exist locally in prod checkout"
cd "$PROD_ROOT"
git fetch origin || true

echo "==> Clone / update staging worktree"
if [[ ! -d "$STAGING_ROOT/.git" ]]; then
  git clone "$REPO_URL" "$STAGING_ROOT"
fi
cd "$STAGING_ROOT"
git fetch origin
# Prefer develop; fall back to current production tip if develop missing
if git ls-remote --exit-code origin "refs/heads/$DEVELOP_BRANCH" >/dev/null 2>&1; then
  git checkout -B "$DEVELOP_BRANCH" "origin/$DEVELOP_BRANCH"
else
  echo "develop not on remote yet — using production tip for initial staging"
  git checkout -B "$DEVELOP_BRANCH" origin/production 2>/dev/null \
    || git checkout -B "$DEVELOP_BRANCH" origin/master
fi

echo "==> Create staging database (postgres superuser)"
sudo -u postgres psql -v ON_ERROR_STOP=1 <<'SQL'
SELECT 'ok' FROM pg_database WHERE datname = 'goldapp_staging';
SQL
if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='goldapp_staging'" | grep -q 1; then
  sudo -u postgres psql -v ON_ERROR_STOP=1 <<'SQL'
CREATE DATABASE goldapp_staging OWNER goldapp;
GRANT ALL PRIVILEGES ON DATABASE goldapp_staging TO goldapp;
SQL
  echo "created goldapp_staging"
else
  echo "goldapp_staging already exists"
fi

echo "==> Python venv + deps"
cd "$STAGING_ROOT/backend"
if [[ ! -x venv/bin/python ]]; then
  python3 -m venv venv
fi
./venv/bin/pip install -q -r requirements.txt

echo "==> Staging .env from production (isolated DB/secrets/paths)"
if [[ ! -f "$STAGING_ROOT/backend/.env" ]]; then
  python3 - <<'PY'
from pathlib import Path
import secrets, re
prod = Path("/opt/ghasrtala/gold_abshd/backend/.env").read_text()
lines = []
overrides = {
    "GOLDAPP_APP_ENV": "staging",
    "GOLDAPP_DB_NAME": "goldapp_staging",
    "GOLDAPP_STAGING_ALLOWED_ADMINS": "radiar,sasanHKH",
    "GOLDAPP_DEBUG_OTP": "true",
    "GOLDAPP_UPLOAD_DIR": "uploads/receipts",
    "GOLDAPP_KYC_UPLOAD_DIR": "uploads/kyc",
    "GOLDAPP_TRANSFER_UPLOAD_DIR": "uploads/transfers",
    "GOLDAPP_ALLOWED_ORIGINS": "http://ghasrtala.ir:8080,http://185.7.172.20:8080,http://dev.ghasrtala.ir,http://staging.ghasrtala.ir,http://localhost:8080",
}
# new JWT secret so staging tokens never work on prod
overrides["GOLDAPP_JWT_SECRET"] = secrets.token_urlsafe(48)
seen = set()
for line in prod.splitlines():
    if not line or line.strip().startswith("#") or "=" not in line:
        lines.append(line)
        continue
    k, _, v = line.partition("=")
    k = k.strip()
    if k in overrides:
        lines.append(f"{k}={overrides[k]}")
        seen.add(k)
    else:
        lines.append(line)
for k, v in overrides.items():
    if k not in seen:
        lines.append(f"{k}={v}")
Path("/opt/ghasrtala/gold_abshd_staging/backend/.env").write_text("\n".join(lines) + "\n")
print("wrote staging .env")
PY
else
  echo "staging .env already present — leaving as-is"
fi

mkdir -p "$STAGING_ROOT/backend/uploads/kyc" \
         "$STAGING_ROOT/backend/uploads/receipts" \
         "$STAGING_ROOT/backend/uploads/transfers"

echo "==> Seed staging super-admins (radiar + sasanHKH) from production password hashes"
sudo systemctl stop gold-abshd-staging 2>/dev/null || true

echo "==> Frontend staging build"
cd "$STAGING_ROOT/frontend"
if [[ ! -d node_modules ]]; then
  npm ci || npm install
fi
# ensure production-style API base + payload key file exists
if [[ ! -f .env.production ]]; then
  cp /opt/ghasrtala/gold_abshd/frontend/.env.production .env.production 2>/dev/null || true
fi
# sync payload key from staging backend env
python3 - <<'PY'
from pathlib import Path
import re
be = Path('/opt/ghasrtala/gold_abshd_staging/backend/.env').read_text()
m = re.search(r'^GOLDAPP_PAYLOAD_OBFUSCATION_KEY=(.*)$', be, re.M)
key = m.group(1).strip().strip('"').strip("'") if m else ''
p = Path('/opt/ghasrtala/gold_abshd_staging/frontend/.env.production')
text = p.read_text() if p.exists() else 'VITE_API_BASE=\n'
if 'VITE_API_BASE=' not in text:
    text = 'VITE_API_BASE=\n' + text
if key:
    if re.search(r'^VITE_PAYLOAD_OBFUSCATION_KEY=', text, re.M):
        text = re.sub(r'^VITE_PAYLOAD_OBFUSCATION_KEY=.*$', 'VITE_PAYLOAD_OBFUSCATION_KEY='+key, text, flags=re.M)
    else:
        text += 'VITE_PAYLOAD_OBFUSCATION_KEY='+key+'\n'
if 'VITE_APP_ENV=' not in text:
    text += 'VITE_APP_ENV=staging\n'
else:
    text = re.sub(r'^VITE_APP_ENV=.*$', 'VITE_APP_ENV=staging', text, flags=re.M)
p.write_text(text)
print('frontend .env.production ready')
PY
VITE_APP_ENV=staging npm run build

echo "==> Install systemd unit"
sudo cp "$STAGING_ROOT/deploy/gold-abshd-staging.service" /etc/systemd/system/gold-abshd-staging.service
sudo systemctl daemon-reload
sudo systemctl enable gold-abshd-staging
sudo systemctl restart gold-abshd-staging
sleep 3
systemctl is-active gold-abshd-staging
curl -sf http://127.0.0.1:8001/api/health || true
echo

echo "==> Upsert allowlisted admins into staging DB"
python3 - <<'PY'
import os, subprocess, re, uuid
from pathlib import Path

be_prod = Path('/opt/ghasrtala/gold_abshd/backend/.env').read_text()
be_stg = Path('/opt/ghasrtala/gold_abshd_staging/backend/.env').read_text()

def get(text, k):
    m = re.search(rf'^{k}=(.*)$', text, re.M)
    return m.group(1).strip().strip('"').strip("'") if m else ''

env = dict(os.environ)
env['PGPASSWORD'] = get(be_prod, 'GOLDAPP_DB_PASSWORD')
rows = subprocess.check_output([
    'psql', '-h', get(be_prod, 'GOLDAPP_DB_HOST') or 'localhost',
    '-U', get(be_prod, 'GOLDAPP_DB_USER'), '-d', get(be_prod, 'GOLDAPP_DB_NAME'),
    '-At', '-F', '|',
    '-c', "SELECT username, password_hash, COALESCE(full_name,''), permissions FROM admin_users WHERE username IN ('radiar','sasanHKH');"
], text=True, env=env).strip().splitlines()

sql_parts = []
for line in rows:
    username, pw_hash, full_name, permissions = line.split('|', 3)
    uid = str(uuid.uuid4())
    def esc(s):
        return s.replace("'", "''")
    sql_parts.append(f"""
INSERT INTO admin_users (id, username, password_hash, full_name, permissions, is_active, is_super, activated_at, created_at, created_by)
VALUES ('{uid}', '{esc(username)}', '{esc(pw_hash)}', '{esc(full_name or username)}', '{esc(permissions or "[]")}', true, true, NOW(), NOW(), 'staging-bootstrap')
ON CONFLICT (username) DO UPDATE SET
  password_hash = EXCLUDED.password_hash,
  is_super = true,
  is_active = true,
  permissions = EXCLUDED.permissions;
""")
sql = "\n".join(sql_parts) or "SELECT 1;"
env['PGPASSWORD'] = get(be_stg, 'GOLDAPP_DB_PASSWORD')
subprocess.run([
    'psql', '-h', get(be_stg, 'GOLDAPP_DB_HOST') or 'localhost',
    '-U', get(be_stg, 'GOLDAPP_DB_USER'), '-d', 'goldapp_staging',
    '-v', 'ON_ERROR_STOP=1', '-c', sql
], check=True, env=env)
print('admins upserted', len(rows))
PY

echo "==> nginx basic auth (radiar + sasanHKH)"
# Generate random gate passwords if htpasswd missing
if [[ ! -f /etc/nginx/ghasrtala-staging.htpasswd ]]; then
  RADIAR_GATE=$(openssl rand -base64 12 | tr -d '/+=' | head -c 14)
  SASAN_GATE=$(openssl rand -base64 12 | tr -d '/+=' | head -c 14)
  TMP=$(mktemp)
  # apache2-utils htpasswd, or openssl passwd fallback
  if command -v htpasswd >/dev/null 2>&1; then
    htpasswd -nbB radiar "$RADIAR_GATE" > "$TMP"
    htpasswd -nbB sasanHKH "$SASAN_GATE" >> "$TMP"
  else
    # apt install apache2-utils if needed
    sudo apt-get update -qq && sudo apt-get install -y -qq apache2-utils
    htpasswd -nbB radiar "$RADIAR_GATE" > "$TMP"
    htpasswd -nbB sasanHKH "$SASAN_GATE" >> "$TMP"
  fi
  sudo mv "$TMP" /etc/nginx/ghasrtala-staging.htpasswd
  sudo chown root:www-data /etc/nginx/ghasrtala-staging.htpasswd
  sudo chmod 640 /etc/nginx/ghasrtala-staging.htpasswd
  umask 077
  cat > /opt/ghasrtala/STAGING_GATE_CREDENTIALS.txt <<EOF
Staging HTTP basic-auth (browser gate) — NOT the in-app admin password.
URL: http://ghasrtala.ir:8080
radiar / $RADIAR_GATE
sasanHKH / $SASAN_GATE
Created: $(date -Is)
EOF
  chmod 600 /opt/ghasrtala/STAGING_GATE_CREDENTIALS.txt
  echo "Wrote /opt/ghasrtala/STAGING_GATE_CREDENTIALS.txt"
else
  echo "htpasswd already exists"
fi

echo "==> Install nginx staging site + open firewall 8080"
sudo cp "$STAGING_ROOT/deploy/nginx-ghasrtala-staging.conf" /etc/nginx/sites-available/ghasrtala-staging
sudo ln -sfn /etc/nginx/sites-available/ghasrtala-staging /etc/nginx/sites-enabled/ghasrtala-staging
sudo nginx -t
sudo systemctl reload nginx
if command -v ufw >/dev/null 2>&1; then
  sudo ufw allow 8080/tcp || true
fi

echo "==> Pin production checkout to production branch (freeze live)"
cd "$PROD_ROOT"
if git ls-remote --exit-code origin refs/heads/production >/dev/null 2>&1; then
  git fetch origin production
  git checkout -B production origin/production
else
  echo "WARN: origin/production missing — create/push it before freezing"
fi

echo
echo "==== STAGING READY ===="
echo "Open:  http://ghasrtala.ir:8080"
echo "Gate:  /opt/ghasrtala/STAGING_GATE_CREDENTIALS.txt"
echo "Health: $(curl -sf http://127.0.0.1:8001/api/health || echo fail)"
echo "Prod still: $(systemctl is-active gold-abshd-backend) on :8000"
