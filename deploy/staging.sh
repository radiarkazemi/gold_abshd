#!/usr/bin/env bash
# Deploy STAGING only. Never restarts production.
set -euo pipefail

STAGING_ROOT="${STAGING_ROOT:-/opt/ghasrtala/gold_abshd_staging}"
BRANCH="${STAGING_BRANCH:-develop}"

cd "$STAGING_ROOT"
git fetch origin "$BRANCH"
git checkout -B "$BRANCH" "origin/$BRANCH"
git reset --hard "origin/$BRANCH"

mkdir -p backend/uploads/kyc backend/uploads/receipts backend/uploads/transfers

cd frontend
# staging build: same-origin API on staging host + staging banner
export VITE_APP_ENV=staging
# keep payload key / empty API base from .env.production
npm run build

# recovery stubs optional — skip on staging

sudo systemctl restart gold-abshd-staging
sleep 2
systemctl is-active gold-abshd-staging
curl -sf "http://127.0.0.1:8001/api/health" | head -c 200
echo
echo "Staging deployed from $BRANCH @ $(git rev-parse --short HEAD)"
