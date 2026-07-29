# AGENTS.md

## Cursor Cloud specific instructions

This repo is a Persian/RTL gold-trading app with two services:

- `backend/` — FastAPI + SQLAlchemy + PostgreSQL. Dev run:
  `cd backend && . .venv/bin/activate && uvicorn app.main:app --reload --host 0.0.0.0 --port 8000`
  (see the module docstring in `backend/app/main.py`). On startup it auto-creates
  the `goldapp` database + tables and seeds the super-admin, so no manual `psql`/migrations.
- `frontend/` — React 19 + Vite. Dev run: `npm run dev` (port 5173). Lint: `npm run lint` (oxlint, warnings only). Scripts live in `frontend/package.json`.

### Non-obvious caveats

- PostgreSQL is NOT auto-started on VM boot. Start it before running the backend:
  `sudo pg_ctlcluster 16 main start`. The app connects over TCP to `localhost:5432` as
  user `postgres` (password-auth), matching `backend/.env`.
- `backend/.env` is git-ignored and required (all vars use the `GOLDAPP_` prefix; see
  `backend/app/config.py`). It is created during environment setup — if it is ever missing,
  recreate it with the DB credentials, an `admin` super-admin bcrypt password hash, and the
  keys below.
- CRITICAL: `GOLDAPP_PAYLOAD_OBFUSCATION_KEY` in `backend/.env` MUST equal
  `VITE_PAYLOAD_OBFUSCATION_KEY` in `frontend/.env`. The price feed is XOR+base64 obfuscated
  (`backend/app/obfuscation.py` / `frontend/src/utils/payloadCodec.js`); if the keys differ,
  the browser decodes prices to garbage and the trading page shows an empty "در حال دریافت قیمت…"
  feed with no visible error.
- `GOLDAPP_DEBUG_OTP=true` makes login OTP codes appear both in the server log and in the API
  response / on the login page ("کد تست"), so login works with no SMS provider.
- Super-admin is seeded ONCE from `GOLDAPP_ADMIN_USERNAME` / `GOLDAPP_ADMIN_PASSWORD_HASH` on
  first startup; afterwards those env values are ignored and credentials live in the DB. The
  admin panel is served by the frontend at path `/admin-hs-panel`.
- Users are invite-only (no self-signup): an admin must create a user (which requires an
  existing Role) to get a phone + registration key; the user's first login needs that key.
  Accounts are single-device — an activated account is bound to the browser's device id.
- With `GOLDAPP_PRICE_SOURCE=simulator` (default for local dev) the app shows a live simulated
  price feed but ORDERS CANNOT BE PLACED — order creation needs the real `api` price source
  (`GOLDAPP_PRICE_SOURCE=api`, goldbridge). This is expected, see `backend/app/main.py`.
- `frontend/src/utils/deviceId.js` imports `uuid`; it must be present in `frontend/package.json`.
