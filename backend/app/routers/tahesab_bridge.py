"""
Windows pull-bridge for Tahesab.

The VPS queues DoNew* jobs; an agent on the Tahesab PC pulls them and
POSTs to https://127.0.0.1:8081 (or http://127.0.0.1:9550).
"""
from __future__ import annotations

import json
from datetime import datetime

from fastapi import APIRouter, Depends, Header, HTTPException
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.config import settings
from app.db import get_db
from app.models_db import TahesabOutbox
from app.services import tahesab

router = APIRouter(prefix="/api/tahesab-bridge", tags=["tahesab-bridge"])


def _require_bridge(authorization: str | None = Header(default=None), x_bridge_token: str | None = Header(default=None)):
    expected = (settings.TAHESAB_BRIDGE_TOKEN or "").strip()
    if not settings.TAHESAB_ENABLED or not expected:
        raise HTTPException(status_code=503, detail="tahesab bridge disabled")
    got = (x_bridge_token or "").strip()
    if not got and authorization:
        parts = authorization.split(" ", 1)
        if len(parts) == 2 and parts[0].lower() == "bearer":
            got = parts[1].strip()
    if not got or got != expected:
        raise HTTPException(status_code=401, detail="invalid bridge token")


class AckIn(BaseModel):
    id: str
    ok: bool
    result: dict | None = None
    error: str | None = None


@router.get("/config")
def bridge_config(_auth=Depends(_require_bridge)):
    return tahesab.bridge_agent_config()


@router.get("/next")
def bridge_next(db: Session = Depends(get_db), _auth=Depends(_require_bridge)):
    job = (
        db.query(TahesabOutbox)
        .filter(TahesabOutbox.status == "pending")
        .order_by(TahesabOutbox.created_at.asc())
        .first()
    )
    if not job:
        return {"job": None}
    try:
        params = json.loads(job.params_json or "[]")
    except json.JSONDecodeError:
        params = []
    return {
        "job": {
            "id": job.id,
            "method": job.method,
            "params": params,
            "ref_type": job.ref_type,
            "ref_id": job.ref_id,
            "body": {job.method: params},
        }
    }


@router.post("/ack")
def bridge_ack(payload: AckIn, db: Session = Depends(get_db), _auth=Depends(_require_bridge)):
    job = db.query(TahesabOutbox).filter(TahesabOutbox.id == payload.id).first()
    if not job:
        raise HTTPException(status_code=404, detail="job not found")

    job.attempts = (job.attempts or 0) + 1
    job.updated_at = datetime.utcnow()
    if payload.ok:
        job.status = "done"
        job.result_json = json.dumps(payload.result or {}, ensure_ascii=False)
        job.last_error = None
        tahesab.apply_bridge_result(db, job, payload.result or {})
    else:
        # Keep pending so the agent retries; mark error after many tries.
        job.last_error = (payload.error or "unknown")[:2000]
        if job.attempts >= 20:
            job.status = "error"
        else:
            job.status = "pending"
    db.add(job)
    db.commit()
    return {"status": job.status}


@router.get("/status")
def bridge_status(db: Session = Depends(get_db), _auth=Depends(_require_bridge)):
    pending = db.query(TahesabOutbox).filter(TahesabOutbox.status == "pending").count()
    done = db.query(TahesabOutbox).filter(TahesabOutbox.status == "done").count()
    error = db.query(TahesabOutbox).filter(TahesabOutbox.status == "error").count()
    return {
        "pending": pending,
        "done": done,
        "error": error,
        "mode": settings.TAHESAB_MODE,
        "enabled": settings.TAHESAB_ENABLED,
    }


@router.get("/agent.ps1", response_class=PlainTextResponse)
def bridge_agent_script():
    """
    Downloadable Windows PowerShell agent. Open on the Tahesab PC:
      powershell -ExecutionPolicy Bypass -File agent.ps1
    Or: irm https://ghasrtala.ir/api/tahesab-bridge/agent.ps1 | iex
    (script embeds bridge URL; token still required via env or prompt)
    """
    token = (settings.TAHESAB_BRIDGE_TOKEN or "").replace("'", "''")
    base = "https://ghasrtala.ir"
    script = f'''# Tahesab pull-bridge for قصر طلا — run on the Windows PC where Tahesab API is open
$ErrorActionPreference = "Continue"
$BridgeBase = "{base}"
$BridgeToken = if ($env:GOLDAPP_TAHESAB_BRIDGE_TOKEN) {{ $env:GOLDAPP_TAHESAB_BRIDGE_TOKEN }} else {{ "{token}" }}
$Headers = @{{ "X-Bridge-Token" = $BridgeToken; "Accept" = "application/json" }}

Write-Host "Fetching Tahesab config from VPS..."
try {{
  $cfg = Invoke-RestMethod -Uri "$BridgeBase/api/tahesab-bridge/config" -Headers $Headers -TimeoutSec 30
}} catch {{
  Write-Host "ERROR: cannot reach bridge config: $_"
  exit 1
}}

$TahesabUrl = $cfg.tahesab_base_url
$TahesabToken = $cfg.tahesab_token
$DbName = $cfg.tahesab_dbname
$VerifySsl = [bool]$cfg.tahesab_verify_ssl
$Poll = [int]$cfg.poll_seconds
if ($Poll -lt 1) {{ $Poll = 2 }}

if (-not $VerifySsl) {{
  add-type @"
using System.Net;
using System.Security.Cryptography.X509Certificates;
public class TrustAll : ICertificatePolicy {{
  public bool CheckValidationResult(ServicePoint s, X509Certificate c, WebRequest r, int p) {{ return true; }}
}}
"@
  [System.Net.ServicePointManager]::CertificatePolicy = New-Object TrustAll
  [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.SecurityProtocolType]::Tls12
}}

$ThHeaders = @{{
  "Authorization" = "Bearer $TahesabToken"
  "DBName" = $DbName
  "Content-Type" = "application/json"
}}

Write-Host "Bridge OK. Tahesab=$TahesabUrl DB=$DbName — polling every ${{Poll}}s. Ctrl+C to stop."

while ($true) {{
  try {{
    $next = Invoke-RestMethod -Uri "$BridgeBase/api/tahesab-bridge/next" -Headers $Headers -TimeoutSec 30
    if ($null -eq $next.job) {{
      Start-Sleep -Seconds $Poll
      continue
    }}
    $job = $next.job
    Write-Host ("[{0}] {1} id={2}" -f (Get-Date -Format "HH:mm:ss"), $job.method, $job.id)
    $body = $job.body | ConvertTo-Json -Compress -Depth 10
    try {{
      $resp = Invoke-WebRequest -Uri $TahesabUrl -Method POST -Headers $ThHeaders -Body ([System.Text.Encoding]::UTF8.GetBytes($body)) -ContentType "application/json" -TimeoutSec 60
      $text = $resp.Content
      $parsed = $text | ConvertFrom-Json
      $ack = @{{ id = $job.id; ok = $true; result = $parsed }} | ConvertTo-Json -Compress -Depth 10
      Invoke-RestMethod -Uri "$BridgeBase/api/tahesab-bridge/ack" -Method POST -Headers $Headers -Body $ack -ContentType "application/json" -TimeoutSec 30 | Out-Null
      Write-Host "  OK: $text"
    }} catch {{
      $err = "$_"
      Write-Host "  FAIL: $err"
      $ack = @{{ id = $job.id; ok = $false; error = $err }} | ConvertTo-Json -Compress -Depth 5
      Invoke-RestMethod -Uri "$BridgeBase/api/tahesab-bridge/ack" -Method POST -Headers $Headers -Body $ack -ContentType "application/json" -TimeoutSec 30 | Out-Null
      Start-Sleep -Seconds 3
    }}
  }} catch {{
    Write-Host "poll error: $_"
    Start-Sleep -Seconds $Poll
  }}
}}
'''
    return PlainTextResponse(script, media_type="text/plain; charset=utf-8")
