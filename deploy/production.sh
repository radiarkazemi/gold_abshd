#!/usr/bin/env bash
# Deploy PRODUCTION only. Never restarts staging.
set -euo pipefail

PROD_ROOT="${PROD_ROOT:-/opt/ghasrtala/gold_abshd}"
BRANCH="${PROD_BRANCH:-production}"

cd "$PROD_ROOT"
git fetch origin "$BRANCH"
git checkout -B "$BRANCH" "origin/$BRANCH"
git reset --hard "origin/$BRANCH"

mkdir -p backend/uploads/kyc backend/uploads/receipts backend/uploads/transfers

cd frontend
# production build (VITE_APP_ENV unset → no staging banner)
unset VITE_APP_ENV || true
npm run build

sudo systemctl restart gold-abshd-backend
sleep 2
systemctl is-active gold-abshd-backend
curl -sf "http://127.0.0.1:8000/api/health" | head -c 200 || curl -sf "http://127.0.0.1:8000/api/price" >/dev/null
echo
echo "Production deployed from $BRANCH @ $(git rev-parse --short HEAD)"
