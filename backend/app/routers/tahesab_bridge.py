"""
Windows pull-bridge for Tahesab.

The VPS queues DoNew* jobs; an agent on the Tahesab PC pulls them and
POSTs to https://127.0.0.1:8081 (or http://127.0.0.1:9550).
"""
from __future__ import annotations

import json
from datetime import datetime

from fastapi import APIRouter, Depends, Header, HTTPException
from fastapi.responses import PlainTextResponse, Response
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
    # Tahesab often wraps payloads as a one-element JSON array; accept both.
    result: dict | list | None = None
    error: str | None = None
    # True for business errors that must not be retried (e.g. duplicate phone
    # when lookup also failed). Transient network errors leave this false.
    permanent: bool = False


def _normalize_ack_result(result: dict | list | None) -> dict:
    """Unwrap [{...}] / [{...}, ...] Tahesab envelopes into one dict for apply_*."""
    if result is None:
        return {}
    if isinstance(result, dict):
        return result
    if isinstance(result, list):
        merged: dict = {}
        for item in result:
            if isinstance(item, dict):
                merged.update(item)
        return merged
    return {}


@router.get("/config")
def bridge_config(_auth=Depends(_require_bridge)):
    return tahesab.bridge_agent_config()


@router.get("/next")
def bridge_next(db: Session = Depends(get_db), _auth=Depends(_require_bridge)):
    from datetime import timedelta

    from sqlalchemy import or_, and_

    from app.models_db import Order, User

    now = datetime.utcnow()
    stale_before = now - timedelta(seconds=20)
    # Drop asnad jobs the agent abandoned so PDF refresh cannot stick forever.
    tahesab.release_stale_asnad_jobs(db)
    ready = or_(
        TahesabOutbox.status == "pending",
        and_(
            TahesabOutbox.status == "claimed",
            TahesabOutbox.updated_at < stale_before,
        ),
    )
    # Serve DoListAsnad first so PDF ledger refresh is never starved by مانده.
    job = (
        db.query(TahesabOutbox)
        .filter(ready, TahesabOutbox.method == tahesab.ASNAD_METHOD)
        .order_by(TahesabOutbox.created_at.asc())
        .first()
    )
    if not job:
        tahesab.maybe_enqueue_online_mande_refresh(db)
        db.commit()
        job = (
            db.query(TahesabOutbox)
            .filter(ready)
            .order_by(TahesabOutbox.created_at.asc())
            .first()
        )
    if not job:
        return {"job": None}
    try:
        params = json.loads(job.params_json or "[]")
    except json.JSONDecodeError:
        params = []

    # Keep sanad moshtari_code in sync with the linked user (fixes phone-link races).
    if (
        job.method in ("DoNewSanadBuySaleGOLD", "DoNewSanadBuySaleSEKEH")
        and job.ref_type == "order"
        and job.ref_id
        and len(params) > 1
    ):
        order = db.query(Order).filter(Order.id == job.ref_id).first()
        if order and order.user_id:
            user = db.query(User).filter(User.id == order.user_id).first()
            if user and user.tahesab_moshtari_id is not None:
                live = int(user.tahesab_moshtari_id)
                if params[1] != live:
                    params[1] = live
                    job.params_json = json.dumps(params, ensure_ascii=False)

    mapped = [tahesab._persian_for_tahesab(p) for p in params]
    body = {job.method: mapped}
    body_json = json.dumps(body, ensure_ascii=True, separators=(",", ":"))

    job.status = "claimed"
    job.updated_at = now
    db.add(job)
    db.commit()

    return {
        "job": {
            "id": job.id,
            "method": job.method,
            "params": mapped,
            "ref_type": job.ref_type,
            "ref_id": job.ref_id,
            "body": body,
            "body_json": body_json,
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
        result = _normalize_ack_result(payload.result)
        job.status = "done"
        job.result_json = json.dumps(result, ensure_ascii=False)
        job.last_error = None
        tahesab.apply_bridge_result(db, job, result)
    else:
        job.last_error = (payload.error or "unknown")[:2000]
        # Permanent business errors (duplicate phone, etc.) or too many tries.
        if payload.permanent or job.attempts >= 8:
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
    # NOTE: this is a Python f-string — double every PowerShell `{` / `}` that
    # must survive into the downloaded .ps1 (including -f placeholders).
    script = f'''# Tahesab pull-bridge — run on the Windows PC where TEST Tahesab API is open
$ErrorActionPreference = "Continue"
$ProgressPreference = "SilentlyContinue"
try {{
  chcp 65001 | Out-Null
  [Console]::InputEncoding  = New-Object System.Text.UTF8Encoding $false
  [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false
  $OutputEncoding = [Console]::OutputEncoding
}} catch {{}}
$BridgeBase = "{base}"
$BridgeToken = if ($env:GOLDAPP_TAHESAB_BRIDGE_TOKEN) {{ $env:GOLDAPP_TAHESAB_BRIDGE_TOKEN }} else {{ "{token}" }}
$Headers = @{{ "X-Bridge-Token" = $BridgeToken; "Accept" = "application/json" }}

Write-Host "Fetching Tahesab config from VPS..."
try {{
  # PS 5.1 often mis-decodes UTF-8 JSON as Latin-1 — force UTF-8 via WebClient.
  $wc = New-Object System.Net.WebClient
  $wc.Headers["X-Bridge-Token"] = $BridgeToken
  $wc.Headers["Accept"] = "application/json"
  $wc.Encoding = [System.Text.Encoding]::UTF8
  $cfg = ($wc.DownloadString("$BridgeBase/api/tahesab-bridge/config")) | ConvertFrom-Json
  $wc.Dispose()
}} catch {{
  Write-Host "ERROR: cannot reach bridge config: $_"
  exit 1
}}

$TahesabUrl = [string]$cfg.tahesab_base_url
$TahesabToken = [string]$cfg.tahesab_token
$DbName = [string]$cfg.tahesab_dbname
$VerifySsl = [bool]$cfg.tahesab_verify_ssl
$TargetLabel = [string]$cfg.target_label
if (-not $TargetLabel) {{ $TargetLabel = "TEST" }}
# Keep banner ASCII-safe in older Windows consoles
if ($TargetLabel -match "[^\\x00-\\x7F]") {{ $TargetLabel = "TEST" }}
$Allowed = @()
if ($cfg.allowed_dbnames) {{ $Allowed = @($cfg.allowed_dbnames | ForEach-Object {{ "$_".ToLower() }}) }}
$Blocked = @()
if ($cfg.blocked_dbnames) {{ $Blocked = @($cfg.blocked_dbnames | ForEach-Object {{ "$_".ToLower() }}) }}
$Poll = [int]$cfg.poll_seconds
if ($Poll -lt 1) {{ $Poll = 2 }}

if (-not $VerifySsl) {{
  try {{
    add-type @"
using System.Net;
using System.Net.Security;
using System.Security.Cryptography.X509Certificates;
public static class TahesabTls {{
  public static void Trust() {{
    ServicePointManager.ServerCertificateValidationCallback =
      delegate {{ return true; }};
    ServicePointManager.SecurityProtocol =
      SecurityProtocolType.Tls12 | SecurityProtocolType.Tls11 | SecurityProtocolType.Tls;
  }}
}}
"@
    [TahesabTls]::Trust()
  }} catch {{
    # Already registered from a previous run in this session — ignore.
  }}
}}

$ThHeaders = @{{
  "Authorization" = "Bearer $TahesabToken"
  "DBName" = $DbName
  "Accept" = "application/json"
}}

Write-Host ""
Write-Host "############################################" -ForegroundColor Yellow
Write-Host "  TARGET: $TargetLabel  (TEST books only)" -ForegroundColor Yellow
Write-Host "  DBName header: $DbName" -ForegroundColor Yellow
Write-Host "  Do NOT enable API on MAIN Tahesab" -ForegroundColor Yellow
Write-Host "  Body: ASCII JSON with \\uXXXX Persian escapes" -ForegroundColor Yellow
Write-Host "############################################" -ForegroundColor Yellow
Write-Host ""

function Get-BridgeJson([string]$Url) {{
  $wc = New-Object System.Net.WebClient
  try {{
    $wc.Headers["X-Bridge-Token"] = $BridgeToken
    $wc.Headers["Accept"] = "application/json"
    $wc.Encoding = [System.Text.Encoding]::UTF8
    return $wc.DownloadString($Url)
  }} finally {{
    $wc.Dispose()
  }}
}}

function Send-TahesabJson([string]$Json) {{
  # Wire format must be ASCII JSON like {{"DoNewMoshtari":["\\u0631\\u0636\\u0627",...]}}.
  # Tahesab's JSON parser expands \\uXXXX using the Iran/Windows locale into Access.
  # Never send raw UTF-8 Persian bytes (logs as \\u00d9\\u0085... and UI shows Ø±Ø¶Ø§).
  if ([string]::IsNullOrWhiteSpace($Json)) {{ throw "empty Tahesab JSON body" }}
  if ($Json -match 'isfixedsize|syncroot|"keys"') {{
    throw "refusing to send Hashtable dump instead of JSON: $Json"
  }}
  if ($Json -match '\\\\u00d[89]') {{
    throw "refusing double-encoded UTF-8 mojibake body: $Json"
  }}
  $bytes = [System.Text.Encoding]::ASCII.GetBytes($Json)
  $hex = ($bytes[0..([Math]::Min(24, $bytes.Length-1))] | ForEach-Object {{ $_.ToString('X2') }}) -join ' '
  Write-Host ("  POST ascii-json len=" + $bytes.Length + " head=" + $Json.Substring(0, [Math]::Min(90, $Json.Length)))
  Write-Host ("  HEX " + $hex)

  # KeepAlive=false: Tahesab closes HTTP/1.1 connections after 400 and
  # WebClient then throws "connection was expected to be kept alive".
  $req = [System.Net.HttpWebRequest]::Create($TahesabUrl)
  $req.Method = "POST"
  $req.KeepAlive = $false
  $req.ProtocolVersion = [System.Net.HttpVersion]::Version10
  $req.Timeout = 60000
  $req.ReadWriteTimeout = 60000
  $req.ContentType = "application/json; charset=utf-8"
  $req.Accept = "application/json"
  $req.Headers["Authorization"] = "Bearer $TahesabToken"
  $req.Headers["DBName"] = $DbName
  $req.ContentLength = $bytes.Length
  $req.ServicePoint.Expect100Continue = $false
  $out = $req.GetRequestStream()
  $out.Write($bytes, 0, $bytes.Length)
  $out.Close()

  $resp = $null
  try {{
    $resp = $req.GetResponse()
  }} catch [System.Net.WebException] {{
    $resp = $_.Exception.Response
    if ($null -eq $resp) {{ throw }}
  }}
  try {{
    $rs = $resp.GetResponseStream()
    $reader = New-Object System.IO.StreamReader($rs, [System.Text.Encoding]::UTF8)
    $respText = $reader.ReadToEnd()
    $reader.Close()
  }} finally {{
    if ($resp) {{ $resp.Close() }}
  }}
  if ([string]::IsNullOrWhiteSpace($respText)) {{ return @{{ OK = $true }} }}
  return ($respText | ConvertFrom-Json)
}}

function ConvertTo-TahesabText([string]$Text) {{
  if ([string]::IsNullOrEmpty($Text)) {{ return $Text }}
  $t = $Text -replace [char]0x200C, ''
  return (($t -replace [char]0x06CC, [char]0x064A) -replace [char]0x06A9, [char]0x0643)
}}

function ConvertTo-JsonValue($Value) {{
  if ($null -eq $Value) {{ return "null" }}
  if ($Value -is [bool]) {{
    if ($Value) {{ return "true" }} else {{ return "false" }}
  }}
  if ($Value -is [int] -or $Value -is [long] -or $Value -is [double] -or $Value -is [decimal]) {{
    return ([string]$Value)
  }}
  $s = ConvertTo-TahesabText ([string]$Value)
  $sb = New-Object System.Text.StringBuilder
  [void]$sb.Append('"')
  foreach ($ch in $s.ToCharArray()) {{
    $c = [int][char]$ch
    if ($ch -eq '"') {{ [void]$sb.Append('\\\"') }}
    elseif ($ch -eq '\\') {{ [void]$sb.Append('\\\\') }}
    elseif ($c -lt 32 -or $c -gt 126) {{
      [void]$sb.Append('\\u')
      [void]$sb.AppendFormat('{{0:x4}}', $c)
    }} else {{
      [void]$sb.Append($ch)
    }}
  }}
  [void]$sb.Append('"')
  return $sb.ToString()
}}

function Build-TahesabJson([string]$Method, $Params) {{
  $parts = New-Object System.Collections.Generic.List[string]
  foreach ($p in @($Params)) {{
    [void]$parts.Add((ConvertTo-JsonValue $p))
  }}
  return ('{{"' + $Method + '":[' + ($parts -join ',') + ']}}')
}}

function Send-Tahesab([string]$Method, $Params) {{
  return Send-TahesabJson (Build-TahesabJson $Method $Params)
}}

function Ack-Bridge([string]$Id, [bool]$Ok, $Result, [string]$ErrorText, [bool]$Permanent) {{
  $ackObj = [pscustomobject]@{{
    id = $Id
    ok = $Ok
    permanent = $Permanent
  }}
  if ($null -ne $Result) {{
    $ackObj | Add-Member -NotePropertyName result -NotePropertyValue $Result
  }}
  if ($ErrorText) {{
    $ackObj | Add-Member -NotePropertyName error -NotePropertyValue $ErrorText
  }}
  $ackJson = $ackObj | ConvertTo-Json -Compress -Depth 20
  Invoke-RestMethod -Uri "$BridgeBase/api/tahesab-bridge/ack" -Method POST -Headers $Headers `
    -Body ([System.Text.Encoding]::UTF8.GetBytes($ackJson)) `
    -ContentType "application/json; charset=utf-8" `
    -TimeoutSec 30 -UseBasicParsing | Out-Null
}}

function Resolve-DuplicateMoshtari($Params, [string]$ErrText) {{
  # DoListMoshtari by phone: {{"DoListMoshtari":[912...]}}
  $tel = ""
  if ($Params -and $Params.Count -ge 3) {{ $tel = [string]$Params[2] }}
  $digits = ($tel -replace '[^\d]', '')
  if (-not $digits) {{ return $null }}
  $candidates = @($digits)
  if ($digits.StartsWith("0") -and $digits.Length -gt 1) {{ $candidates += $digits.Substring(1) }}
  elseif (-not $digits.StartsWith("0")) {{ $candidates += ("0" + $digits) }}
  foreach ($c in $candidates) {{
    try {{
      $asNum = [int64]0
      if ([int64]::TryParse($c, [ref]$asNum)) {{
        $list = Send-Tahesab "DoListMoshtari" @($asNum)
      }} else {{
        $list = Send-Tahesab "DoListMoshtari" @($c)
      }}
      if ($null -eq $list) {{ continue }}
      foreach ($prop in $list.PSObject.Properties) {{
        $row = $prop.Value
        if ($null -eq $row) {{ continue }}
        $code = $null
        if ($row.Code) {{ $code = $row.Code }} elseif ($row.code) {{ $code = $row.code }}
        if ($null -ne $code) {{
          Write-Host "  Linked existing moshtari Code=$code (phone was duplicate)"
          return @{{ OK = [int]$code; linked = $true; note = $ErrText }}
        }}
      }}
    }} catch {{
      Write-Host "  lookup try $c failed: $_"
    }}
  }}
  # Tahesab already has this phone — use the code we asked to create.
  if ($Params -and $Params.Count -ge 9) {{
    try {{
      $pref = [int]$Params[8]
      if ($pref -gt 0) {{
        Write-Host "  Linked requested moshtari Code=$pref (duplicate phone, list lookup skipped)"
        return @{{ OK = $pref; linked = $true; note = $ErrText }}
      }}
    }} catch {{}}
  }}
  return $null
}}

# Safety: confirm the live API opened the TEST database, not main books.
try {{
  $health = $null
  try {{
    $health = Invoke-RestMethod -Uri ($TahesabUrl.TrimEnd('/') + "/CheckHealth") -Method GET -Headers $ThHeaders -TimeoutSec 20 -UseBasicParsing
  }} catch {{
    $health = Send-Tahesab "CheckHealth" @()
  }}
  $liveDb = [string]$health.DBName
  if (-not $liveDb) {{ $liveDb = [string]$health.dbname }}
  $liveDbNorm = $liveDb.ToLower()
  Write-Host ("CheckHealth: Api=" + [string]$health.Api_Status + " DBType=" + [string]$health.DBType + " DBName=" + $liveDb)
  if ($Blocked -contains $liveDbNorm) {{
    Write-Host "STOP: DBName=$liveDb is BLOCKED (main/production). Nothing will be written." -ForegroundColor Red
    exit 2
  }}
  if ($Allowed.Count -gt 0 -and -not ($Allowed -contains $liveDbNorm)) {{
    Write-Host ("STOP: DBName=$liveDb is not in allow-list [" + ($Allowed -join ", ") + "].") -ForegroundColor Red
    Write-Host "Open the TEST Tahesab API (not main) and/or fix GOLDAPP_TAHESAB_ALLOWED_DBNAMES." -ForegroundColor Red
    exit 2
  }}
  Write-Host "DB guard OK — writing only to target '$TargetLabel' (DBName=$liveDb)." -ForegroundColor Green
}} catch {{
  Write-Host "ERROR: CheckHealth failed. Is the TEST Tahesab API open on $TahesabUrl ?" -ForegroundColor Red
  Write-Host "$_"
  exit 1
}}

Write-Host "Bridge OK. Tahesab=$TahesabUrl DB=$DbName — polling every ${{Poll}}s. Ctrl+C to stop."

while ($true) {{
  try {{
    $next = (Get-BridgeJson "$BridgeBase/api/tahesab-bridge/next") | ConvertFrom-Json
    if ($null -eq $next.job) {{
      Start-Sleep -Seconds $Poll
      continue
    }}
    $job = $next.job
    $methodName = [string]$job.method
    $jobId = [string]$job.id
    $stamp = Get-Date -Format "HH:mm:ss"
    Write-Host "[$stamp] $methodName id=$jobId"

    $jsonBody = $null
    if ($job.body_json) {{
      $jsonBody = [string]$job.body_json
      # If PowerShell expanded \\uXXXX into real Persian, rebuild as ASCII escapes.
      if ($jsonBody -match '[^\x00-\x7F]') {{
        Write-Host "  body_json had non-ASCII — rebuilding with \\uXXXX escapes"
        $jsonBody = Build-TahesabJson $methodName $job.params
      }}
    }} else {{
      $jsonBody = Build-TahesabJson $methodName $job.params
    }}
    Write-Host ("  JSON: " + $jsonBody.Substring(0, [Math]::Min(120, $jsonBody.Length)))

    $parsed = $null
    $err = ""
    try {{
      $parsed = Send-TahesabJson $jsonBody
    }} catch {{
      $err = "$_"
      try {{
        if ($_.ErrorDetails -and $_.ErrorDetails.Message) {{
          $parsed = $_.ErrorDetails.Message | ConvertFrom-Json
          $err = [string]$parsed.ERROR
          if (-not $err) {{ $err = [string]$parsed.Error }}
        }}
      }} catch {{}}
    }}

    $errText = ""
    if ($parsed -and ($parsed.ERROR -or $parsed.Error)) {{
      $errText = [string]($(if ($parsed.ERROR) {{ $parsed.ERROR }} else {{ $parsed.Error }}))
    }} elseif ($err) {{
      $errText = $err
    }}

    if ($errText -and $methodName -eq "DoNewMoshtari" -and ($errText -match "تلفن تکراری|شماره.*تکراری|کد.*تکراری|تکراری|duplicate|kept alive|closed by the server")) {{
      $linked = Resolve-DuplicateMoshtari $job.params $errText
      if ($null -ne $linked) {{
        Ack-Bridge $jobId $true $linked "" $false
        Write-Host ("  OK (linked): " + ($linked | ConvertTo-Json -Compress))
        continue
      }}
      Ack-Bridge $jobId $false $null $errText $true
      Write-Host "  FAIL permanent: $errText"
      Start-Sleep -Seconds 2
      continue
    }}

    if ($errText -and $methodName -match "DoNewSanad" -and ($errText -match "Factor_Code|کد فاکتور")) {{
      $factor = $null
      if ($job.params -and @($job.params).Count -ge 18) {{ $factor = [string]$job.params[17] }}
      elseif ($job.params -and @($job.params).Count -ge 16) {{ $factor = [string]$job.params[15] }}
      if (-not $factor) {{ $factor = "duplicate" }}
      Ack-Bridge $jobId $true (@{{ OK = $factor; linked = $true; note = $errText }}) "" $false
      Write-Host "  OK (factor already exists): $factor"
      continue
    }}

    if ($errText) {{
      $permanent = [bool]($errText -match "تکراری|نامعتبر|مجاز نیست")
      Ack-Bridge $jobId $false $null $errText $permanent
      Write-Host ("  FAIL" + $(if ($permanent) {{ " permanent" }} else {{ "" }}) + ": $errText")
      Start-Sleep -Seconds 3
      continue
    }}

    # Tahesab often returns a one-element JSON array; FastAPI ack expects an object.
    if ($parsed -is [System.Array]) {{
      if (@($parsed).Count -eq 1) {{
        $parsed = @($parsed)[0]
      }} else {{
        $merged = [ordered]@{{}}
        foreach ($item in @($parsed)) {{
          if ($null -eq $item) {{ continue }}
          foreach ($prop in $item.PSObject.Properties) {{
            $merged[$prop.Name] = $prop.Value
          }}
        }}
        $parsed = [pscustomobject]$merged
      }}
    }}

    Ack-Bridge $jobId $true $parsed "" $false
    Write-Host ("  OK: " + ($parsed | ConvertTo-Json -Compress -Depth 10))
  }} catch {{
    Write-Host "poll error: $_"
    Start-Sleep -Seconds $Poll
  }}
}}
'''
    return PlainTextResponse(script, media_type="text/plain; charset=utf-8")


def _bat_download(filename: str, content: str) -> Response:
    # CRLF for Windows Notepad / cmd.exe
    body = content.replace("\n", "\r\n").encode("utf-8")
    return Response(
        content=body,
        media_type="application/x-bat",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Cache-Control": "no-store",
        },
    )


@router.get("/agent.bat")
def bridge_agent_bat():
    """
    Double-click daily on the Tahesab Windows PC (API window must be open).
    Download: https://ghasrtala.ir/api/tahesab-bridge/agent.bat
    Always pulls the latest agent.ps1 from the VPS (encoding fix included).
    """
    content = r"""@echo off
chcp 65001 >nul
title GhasrTala - Tahesab Sync (TEST only)
cd /d "%~dp0"

echo ============================================
echo   GhasrTala - Tahesab Sync  [TEST DB ONLY]
echo   Always downloads LATEST script from server
echo ============================================
echo.
echo IMPORTANT:
echo   - Run only against TEST Tahesab (not main)
echo   - Keep TEST API open on port 8081
echo   - Leave this window open; Ctrl+C to stop
echo.
echo After update: Tahesab log must show \u0631\u0636\u0627
echo               NOT the broken \u00d9\u0085 form.
echo.

:loop
echo [%date% %time%] Connecting / updating agent from server...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ProgressPreference='SilentlyContinue'; try { $s = Invoke-WebRequest -Uri 'https://ghasrtala.ir/api/tahesab-bridge/agent.ps1' -UseBasicParsing -TimeoutSec 60; if (-not $s.Content) { throw 'empty agent.ps1' }; Invoke-Expression $s.Content } catch { Write-Host $_; exit 1 }"
echo.
echo [%date% %time%] Disconnected. Retry in 5 seconds...
timeout /t 5 /nobreak >nul
goto loop
"""
    return _bat_download("Tahesab-Sync-GhasrTala.bat", content)


@router.get("/install-autostart.bat")
def bridge_install_autostart_bat():
    """
    One-time install: copies the agent bat and registers a Windows
    Task Scheduler job at user logon (accounting PC).
    """
    content = r"""@echo off
chcp 65001 >nul
title نصب اجرای خودکار همگام‌سازی ته‌حساب
setlocal EnableExtensions

set "DIR=%LOCALAPPDATA%\GhasrTala"
set "BAT=%DIR%\Tahesab-Sync-GhasrTala.bat"
set "TASK=GhasrTala-Tahesab-Sync"

echo در حال آماده‌سازی پوشه...
mkdir "%DIR%" 2>nul

echo در حال دانلود فایل روزانه...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "Invoke-WebRequest -Uri 'https://ghasrtala.ir/api/tahesab-bridge/agent.bat' -OutFile '%BAT%' -UseBasicParsing"

if not exist "%BAT%" (
  echo خطا: دانلود نشد. اینترنت این سیستم را چک کنید.
  pause
  exit /b 1
)

echo در حال ثبت اجرا در شروع ویندوز ^(Task Scheduler^)...
schtasks /Delete /TN "%TASK%" /F >nul 2>&1
schtasks /Create /TN "%TASK%" /TR "\"%BAT%\"" /SC ONLOGON /RL LIMITED /F
if errorlevel 1 (
  echo.
  echo ثبت خودکار ناموفق بود. می‌توانید هر روز خودتان فایل زیر را اجرا کنید:
  echo   %BAT%
  pause
  exit /b 1
)

echo.
echo نصب شد.
echo فایل روزانه: %BAT%
echo اجرای خودکار: با ورود کاربر به ویندوز
echo.
echo همین الان همگام‌سازی را باز می‌کنم...
start "Tahesab Sync" "%BAT%"
pause
"""
    return _bat_download("Install-Tahesab-Sync-Autostart.bat", content)
