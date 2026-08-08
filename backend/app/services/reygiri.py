"""
Proxy lookups against public ریگیری sites (must run from an Iran IP).

  1) reygiri.com  — اتحادیه / کشوری (ReyTala): JS gate + view-rey.asp HTML cards
  2) reygir.ir    — ابهر: ASP.NET JSON ExcuteQuery on baseservice.asmx
"""
from __future__ import annotations

import html as html_lib
import json
import logging
import re
from typing import Any
from urllib.parse import urlencode

import httpx

logger = logging.getLogger(__name__)

NATIONAL_BASE = "https://reygiri.com"
ABHAR_BASE = "https://reygir.ir"

UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)

_PERSIAN_DIGITS = str.maketrans("۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩", "01234567890123456789")


def normalize_ang(value: str) -> str:
    s = (value or "").translate(_PERSIAN_DIGITS)
    s = re.sub(r"\s+", "", s)
    s = re.sub(r"[^\d]", "", s)
    return s


def normalize_series(value: str | None) -> str:
    s = (value or "").strip().upper()
    if s in {"", "A", "B", "C", "D"}:
        return s
    return ""


async def lookup_ang(
    ang: str,
    *,
    series: str = "",
    include_archive: bool = True,
) -> dict[str, Any]:
    ang = normalize_ang(ang)
    series = normalize_series(series)
    if not ang or len(ang) > 15:
        err = "شماره انگ / پاکت نامعتبر است"
        empty_src = {
            "ok": False,
            "error": err,
            "items": [],
            "warnings": [],
            "empty": True,
        }
        return {
            "ang": ang,
            "series": series,
            "include_archive": include_archive,
            "national": {
                **empty_src,
                "source": "reygiri.com",
                "source_label": "سامانه ریگیری کشوری (اتحادیه تهران)",
            },
            "abhar": {
                **empty_src,
                "source": "reygir.ir",
                "source_label": "سامانه ریگیری ابهر",
            },
        }

    national_task = _lookup_national(ang, series=series, include_archive=include_archive)
    abhar_task = _lookup_abhar(ang)
    national, abhar = await _gather_pair(national_task, abhar_task)
    return {
        "ang": ang,
        "series": series,
        "include_archive": include_archive,
        "national": national,
        "abhar": abhar,
    }


async def _gather_pair(a, b):
    import asyncio

    return await asyncio.gather(a, b)


async def _lookup_national(
    ang: str,
    *,
    series: str,
    include_archive: bool,
) -> dict[str, Any]:
    headers = {
        "User-Agent": UA,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "fa-IR,fa;q=0.9,en;q=0.8",
    }
    try:
        async with httpx.AsyncClient(
            headers=headers,
            follow_redirects=True,
            timeout=httpx.Timeout(25.0),
        ) as client:
            token = await _national_unlock(client)
            items: list[dict[str, Any]] = []
            warnings: list[str] = []
            errors: list[str] = []

            # Prefer archive when requested (covers historical packets).
            # Also try current DB so newer packets are not missed.
            modes = [True, False] if include_archive else [False]
            seen: set[str] = set()
            for i, archive in enumerate(modes):
                if i > 0:
                    import asyncio
                    await asyncio.sleep(2.2)
                html, err = await _national_view(
                    client,
                    ang=ang,
                    series=series,
                    archive=archive,
                    request_token=token,
                )
                if err:
                    errors.append(err)
                    # Token may expire; refresh once and retry this mode.
                    if "تازه‌سازی" in err or "403" in err:
                        token = await _national_unlock(client)
                        html, err = await _national_view(
                            client,
                            ang=ang,
                            series=series,
                            archive=archive,
                            request_token=token,
                        )
                        if err:
                            errors.append(err)
                            continue
                    else:
                        continue
                parsed = _parse_national_html(html)
                for item in parsed["items"]:
                    key = json.dumps(item, ensure_ascii=False, sort_keys=True)
                    if key in seen:
                        continue
                    seen.add(key)
                    items.append(item)
                for w in parsed.get("warnings") or []:
                    if w not in warnings:
                        warnings.append(w)
                if parsed.get("foreign_ip"):
                    return {
                        "ok": False,
                        "source": "reygiri.com",
                        "source_label": "سامانه ریگیری کشوری",
                        "error": "دسترسی به سامانه کشوری فقط از آی‌پی ایران ممکن است",
                        "items": [],
                        "warnings": [],
                        "raw_html": None,
                    }

            if not items and errors:
                return {
                    "ok": False,
                    "source": "reygiri.com",
                    "source_label": "سامانه ریگیری کشوری",
                    "error": errors[-1],
                    "items": [],
                    "warnings": warnings,
                }

            return {
                "ok": True,
                "source": "reygiri.com",
                "source_label": "سامانه ریگیری کشوری (اتحادیه تهران)",
                "error": None,
                "items": items,
                "warnings": warnings,
                "empty": len(items) == 0,
            }
    except Exception as e:
        logger.exception("national reygiri lookup failed")
        return {
            "ok": False,
            "source": "reygiri.com",
            "source_label": "سامانه ریگیری کشوری",
            "error": f"خطا در ارتباط با سامانه کشوری: {e}",
            "items": [],
            "warnings": [],
        }


async def _national_unlock(client: httpx.AsyncClient) -> str:
    r = await client.get(f"{NATIONAL_BASE}/index.asp")
    r.raise_for_status()
    text = r.text
    if 'id="lookup-form"' not in text and "lookup-form" not in text:
        n_m = re.search(r'name="n"[^>]*value="([^"]+)"', text)
        if not n_m:
            raise RuntimeError("چالش امنیتی سامانه کشوری قابل عبور نیست")
        n = n_m.group(1)
        ret_m = re.search(r'name="return"[^>]*value="([^"]+)"', text)
        retval = ret_m.group(1) if ret_m else "/index.asp"
        r2 = await client.post(
            f"{NATIONAL_BASE}/challenge.asp",
            data={"n": n, "p": f"{n}-js", "return": retval},
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
        r2.raise_for_status()
        text = r2.text
    token_m = re.search(r'id="request-token"[^>]*value="([^"]+)"', text)
    if not token_m:
        raise RuntimeError("توکن استعلام سامانه کشوری دریافت نشد")
    return token_m.group(1)


async def _national_view(
    client: httpx.AsyncClient,
    *,
    ang: str,
    series: str,
    archive: bool,
    request_token: str,
) -> tuple[str | None, str | None]:
    body = urlencode(
        {
            "n": ang,
            "series": series,
            "archive": "1" if archive else "0",
            "requestToken": request_token,
        }
    )
    r = await client.post(
        f"{NATIONAL_BASE}/view-rey.asp",
        content=body.encode("utf-8"),
        headers={
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
            "X-Requested-With": "XMLHttpRequest",
            "Referer": f"{NATIONAL_BASE}/index.asp",
        },
    )
    if r.status_code == 429:
        return None, "فاصله بین استعلام‌ها کم است؛ چند ثانیه صبر کنید و دوباره جستجو کنید"
    if r.status_code == 403:
        return None, "اعتبار صفحه استعلام پایان یافته؛ نیاز به تازه‌سازی"
    if r.status_code >= 400:
        return None, f"پاسخ نامعتبر سامانه کشوری ({r.status_code})"
    return r.text, None


def _parse_national_html(raw: str) -> dict[str, Any]:
    text = html_lib.unescape(raw or "").strip()
    if "دسترسی به این سامانه فقط از طریق آی پی ایران" in text:
        return {"items": [], "warnings": [], "foreign_ip": True}

    warnings = []
    for m in re.finditer(
        r'<p class="result-warning[^"]*"[^>]*>(.*?)</p>',
        text,
        flags=re.I | re.S,
    ):
        w = re.sub(r"<[^>]+>", "", m.group(1)).strip()
        if w:
            warnings.append(w)

    items: list[dict[str, Any]] = []
    for card_m in re.finditer(
        r'<article class="result-card">(.*?)</article>',
        text,
        flags=re.I | re.S,
    ):
        card = card_m.group(1)
        title_m = re.search(
            r'<header class="result-card-head"[^>]*>(.*?)</header>',
            card,
            flags=re.I | re.S,
        )
        title = re.sub(r"<[^>]+>", "", title_m.group(1)).strip() if title_m else ""
        fields: dict[str, str] = {}
        for item_m in re.finditer(
            r'<div class="result-item">\s*<span>(.*?)</span>\s*<strong[^>]*>(.*?)</strong>\s*</div>',
            card,
            flags=re.I | re.S,
        ):
            label = re.sub(r"<[^>]+>", "", item_m.group(1)).strip()
            value = re.sub(r"<[^>]+>", "", item_m.group(2)).strip()
            # normalize soft hyphen / ZWNJ variants of ری‌گیری
            label_key = label.replace("\u200c", "").replace("ي", "ی").replace("ك", "ک")
            fields[label] = value
            fields[label_key] = value

        def pick(*names: str) -> str | None:
            for name in names:
                for k, v in fields.items():
                    kn = k.replace("\u200c", "").replace("ي", "ی").replace("ك", "ک")
                    if kn == name.replace("\u200c", ""):
                        return v
            return None

        items.append(
            {
                "title": title,
                "karat": pick("عیار"),
                "lab_name": pick("نام ریگیری", "نام ری‌گیری"),
                "register_type": pick("نوع ثبت"),
                "datetime": pick("تاریخ و ساعت"),
                "series": pick("سری"),
                "fields": {
                    k: v
                    for k, v in fields.items()
                    if "\u200c" not in k  # keep clean labels only once
                },
            }
        )

    # Deduplicate fields dict keys that are duplicates without zwnj
    for item in items:
        clean = {}
        for k, v in (item.get("fields") or {}).items():
            nk = k.replace("\u200c", "")
            if nk not in clean:
                clean[nk] = v
        item["fields"] = clean

    if not items and "result-empty" in text:
        return {"items": [], "warnings": warnings, "foreign_ip": False}
    if not items and "result-error" in text:
        err = re.sub(r"<[^>]+>", " ", text)
        err = re.sub(r"\s+", " ", err).strip()
        return {"items": [], "warnings": warnings + ([err] if err else []), "foreign_ip": False}

    return {"items": items, "warnings": warnings, "foreign_ip": False}


async def _lookup_abhar(ang: str) -> dict[str, Any]:
    # Digits-only already enforced — safe to interpolate. Do NOT html-escape
    # quotes here; the live ASMX accepts a normal JSON {"str": "..."} body
    # (verified against reygir.ir) and escaping quotes breaks the SQL.
    query = (
        "select id as rownum,id,code,extrastrtiny,comment,[name] "
        f"from viewitem where extrastrtiny='{ang}' and site_id=1381"
    )
    payload = {"str": query}
    headers = {
        "User-Agent": UA,
        "Content-Type": "application/json; charset=utf-8",
        "Referer": f"{ABHAR_BASE}/",
        "Accept": "application/json, text/javascript, */*; q=0.01",
    }
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(25.0), follow_redirects=True) as client:
            r = await client.post(
                f"{ABHAR_BASE}/baseservice.asmx/ExcuteQuery",
                json=payload,
                headers=headers,
            )
            if r.status_code >= 400:
                return {
                    "ok": False,
                    "source": "reygir.ir",
                    "source_label": "سامانه ریگیری ابهر",
                    "error": f"پاسخ نامعتبر سامانه ابهر ({r.status_code})",
                    "items": [],
                }
            data = r.json()
            raw = data.get("d", "[]")
            if isinstance(raw, str):
                try:
                    rows = json.loads(raw)
                except json.JSONDecodeError:
                    rows = []
            elif isinstance(raw, list):
                rows = raw
            else:
                rows = []

            items = []
            for row in rows:
                items.append(
                    {
                        "owner": (row.get("name") or "").strip() or None,
                        "ang": (row.get("extrastrtiny") or "").strip() or ang,
                        "karat": (row.get("code") or "").strip() or None,
                        "lab_name": (row.get("comment") or "").strip() or None,
                        "id": str(row.get("id") or row.get("rownum") or "") or None,
                        "raw": row,
                    }
                )
            return {
                "ok": True,
                "source": "reygir.ir",
                "source_label": "سامانه ریگیری ابهر",
                "error": None,
                "items": items,
                "empty": len(items) == 0,
            }
    except Exception as e:
        logger.exception("abhar reygiri lookup failed")
        return {
            "ok": False,
            "source": "reygir.ir",
            "source_label": "سامانه ریگیری ابهر",
            "error": f"خطا در ارتباط با سامانه ابهر: {e}",
            "items": [],
        }
