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
    result: dict | None = None
    error: str | None = None
    # True for business errors that must not be retried (e.g. duplicate phone
    # when lookup also failed). Transient network errors leave this false.
    permanent: bool = False


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
  $cfg = Invoke-RestMethod -Uri "$BridgeBase/api/tahesab-bridge/config" -Headers $Headers -TimeoutSec 30 -UseBasicParsing
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
  "Content-Type" = "application/json; charset=utf-8"
  "Accept" = "application/json"
}}

Write-Host ""
Write-Host "############################################" -ForegroundColor Yellow
Write-Host "  TARGET: $TargetLabel  (TEST books only)" -ForegroundColor Yellow
Write-Host "  DBName header: $DbName" -ForegroundColor Yellow
Write-Host "  Do NOT enable API on MAIN Tahesab" -ForegroundColor Yellow
Write-Host "############################################" -ForegroundColor Yellow
Write-Host ""

function ConvertTo-AsciiJson([object]$BodyObj) {{
  # Pure-ASCII JSON with \\uXXXX escapes so Tahesab (and older Windows
  # stacks) never mis-decode Persian as Latin-1/CP1252 mojibake.
  $json = $BodyObj | ConvertTo-Json -Compress -Depth 20
  $sb = New-Object System.Text.StringBuilder
  foreach ($ch in $json.ToCharArray()) {{
    $code = [int][char]$ch
    if ($code -gt 127) {{
      [void]$sb.Append('\\u')
      [void]$sb.AppendFormat('{{0:x4}}', $code)
    }} else {{
      [void]$sb.Append($ch)
    }}
  }}
  return $sb.ToString()
}}

function Send-Tahesab([object]$BodyObj) {{
  $json = ConvertTo-AsciiJson $BodyObj
  $bytes = [System.Text.Encoding]::ASCII.GetBytes($json)
  return Invoke-RestMethod -Uri $TahesabUrl -Method POST -Headers $ThHeaders `
    -Body $bytes `
    -ContentType "application/json; charset=utf-8" `
    -TimeoutSec 60 -UseBasicParsing
}}

function Ack-Bridge([string]$Id, [bool]$Ok, $Result, [string]$ErrorText, [bool]$Permanent) {{
  $ackObj = @{{ id = $Id; ok = $Ok; permanent = $Permanent }}
  if ($null -ne $Result) {{ $ackObj.result = $Result }}
  if ($ErrorText) {{ $ackObj.error = $ErrorText }}
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
        $list = Send-Tahesab (@{{ DoListMoshtari = @($asNum) }})
      }} else {{
        $list = Send-Tahesab (@{{ DoListMoshtari = @($c) }})
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
  return $null
}}

# Safety: confirm the live API opened the TEST database, not main books.
try {{
  $health = Send-Tahesab (@{{ CheckHealth = @() }})
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
    $next = Invoke-RestMethod -Uri "$BridgeBase/api/tahesab-bridge/next" -Headers $Headers -TimeoutSec 30 -UseBasicParsing
    if ($null -eq $next.job) {{
      Start-Sleep -Seconds $Poll
      continue
    }}
    $job = $next.job
    $methodName = [string]$job.method
    $jobId = [string]$job.id
    $stamp = Get-Date -Format "HH:mm:ss"
    Write-Host "[$stamp] $methodName id=$jobId"

    if ($null -ne $job.body) {{
      $bodyObj = $job.body
    }} else {{
      $bodyObj = @{{ $methodName = @($job.params) }}
    }}

    $parsed = $null
    $err = ""
    try {{
      $parsed = Send-Tahesab $bodyObj
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

    if ($errText -and $methodName -eq "DoNewMoshtari" -and ($errText -match "تلفن تکراری|شماره.*تکراری|duplicate")) {{
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

    if ($errText) {{
      $permanent = [bool]($errText -match "تکراری|نامعتبر|مجاز نیست")
      Ack-Bridge $jobId $false $null $errText $permanent
      Write-Host ("  FAIL" + $(if ($permanent) {{ " permanent" }} else {{ "" }}) + ": $errText")
      Start-Sleep -Seconds 3
      continue
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
    """
    content = r"""@echo off
chcp 65001 >nul
title همگام‌سازی ته‌حساب - قصر طلا
cd /d "%~dp0"

echo ============================================
echo   قصر طلا - همگام‌سازی ته‌حساب ^(فقط تست^)
echo ============================================
echo.
echo مهم: فقط روی ته حساب تست اجرا شود.
echo        روی ته حساب اصلی هرگز API را روشن نکنید.
echo.
echo قبل از اجرا:
echo   1^) ته حساب تست باز باشد ^(نه اصلی^)
echo   2^) افزونه API روی تست روشن باشد ^(پورت 8081^)
echo.
echo این پنجره را باز بگذارید. برای توقف: Ctrl+C
echo.

:loop
echo [%date% %time%] در حال اتصال به سرور...
powershell -NoProfile -ExecutionPolicy Bypass -Command "try { irm https://ghasrtala.ir/api/tahesab-bridge/agent.ps1 | iex } catch { Write-Host $_; exit 1 }"
echo.
echo [%date% %time%] ارتباط قطع شد. تلاش دوباره تا ۵ ثانیه دیگر...
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
