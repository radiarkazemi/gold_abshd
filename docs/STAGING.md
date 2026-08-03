# Production vs Staging
#
# Same VPS, same public product domain — but two completely isolated stacks.
#
# | | Production | Staging (dev) |
# |---|---|---|
# | URL | http://ghasrtala.ir | http://ghasrtala.ir:8080 (also dev.ghasrtala.ir when DNS is set) |
# | Code path | /opt/ghasrtala/gold_abshd | /opt/ghasrtala/gold_abshd_staging |
# | Git branch | `production` | `develop` |
# | Database | `goldapp` | `goldapp_staging` |
# | Backend port | 8000 | 8001 |
# | systemd | gold-abshd-backend | gold-abshd-staging |
# | Uploads | backend/uploads | backend/uploads (separate tree) |
# | Who can open | everyone | only main admins `radiar` + `sasanHKH` (nginx basic auth + app allowlist) |
#
# Rule: work and experiments happen on staging / `develop`.
# Production is only updated when you deliberately promote exact changes
# (merge/cherry-pick into `production`, then run deploy/production.sh).
#
# ## Day-to-day
#
# ```bash
# # deploy latest develop → staging (never touches live customers)
# ./deploy/staging.sh
#
# # promote a tested commit to live
# git checkout production
# git merge --ff-only <tested-commit>   # or cherry-pick
# git push origin production
# ./deploy/production.sh
# ```
#
# ## First-time VPS bootstrap
#
# Run once as deploy (with sudo):
#   sudo bash deploy/bootstrap_staging_on_vps.sh
#

## Access

Staging nginx asks for HTTP basic auth. Credentials are created for the
two main admins during bootstrap (same usernames: radiar, sasanHKH).
Store the generated staging gate passwords securely; they are separate
from the admin-panel login passwords inside the app.
