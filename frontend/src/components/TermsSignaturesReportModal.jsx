import { useEffect, useMemo, useState, Fragment } from "react";
import { fetchUserTermsAcceptances } from "../api";
import { formatTehranDateTime } from "../utils/tehranTime";
import JalaliDateInput from "./JalaliDateInput";
import "./TermsSignaturesReportModal.css";

function fa(n) {
  return Number(n).toLocaleString("fa-IR");
}

function formatDate(iso) {
  return formatTehranDateTime(iso);
}

function csvEscape(value) {
  const s = value == null ? "" : String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function fingerprintSummary(fp) {
  if (!fp || typeof fp !== "object") return "";
  const parts = [
    fp.platform,
    fp.timezone,
    fp.screen_width && fp.screen_height ? `${fp.screen_width}×${fp.screen_height}` : null,
    fp.language,
    fp.app_build ? `build:${fp.app_build}` : null,
  ].filter(Boolean);
  return parts.join(" | ");
}

function buildCsv(report) {
  const header = [
    "ردیف",
    "تاریخ پذیرش (تهران)",
    "نسخه قوانین",
    "IP",
    "شناسه دستگاه",
    "امضای دیجیتال (hash)",
    "hash متن قوانین",
    "User-Agent",
    "خلاصه فراداده دستگاه",
    "زمان کلاینت",
  ];
  const lines = [header.map(csvEscape).join(",")];
  (report.items || []).forEach((row, idx) => {
    lines.push(
      [
        idx + 1,
        formatDate(row.accepted_at),
        row.terms_version,
        row.ip_address || "",
        row.device_id || "",
        row.signature_hash || "",
        row.terms_content_hash || "",
        row.user_agent || "",
        fingerprintSummary(row.fingerprint),
        row.accepted_at_client ? formatDate(row.accepted_at_client) : "",
      ]
        .map(csvEscape)
        .join(",")
    );
  });
  // BOM for Excel UTF-8
  return "\uFEFF" + lines.join("\n");
}

function downloadBlob(filename, content, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function buildPrintHtml(report) {
  const title = `گزارش امضای دیجیتال ورود — ${report.full_name || report.phone_number || ""}`;
  const rows = (report.items || [])
    .map(
      (row, idx) => `
      <tr>
        <td>${idx + 1}</td>
        <td>${formatDate(row.accepted_at)}</td>
        <td>${row.terms_version || ""}</td>
        <td dir="ltr">${row.ip_address || "—"}</td>
        <td dir="ltr" style="font-size:10px;word-break:break-all">${row.device_id || ""}</td>
        <td dir="ltr" style="font-size:10px;word-break:break-all">${row.signature_hash || ""}</td>
        <td style="font-size:10px">${fingerprintSummary(row.fingerprint) || "—"}</td>
      </tr>`
    )
    .join("");

  return `<!doctype html>
<html lang="fa" dir="rtl">
<head>
<meta charset="utf-8"/>
<title>${title}</title>
<style>
  body{font-family:Tahoma,Arial,sans-serif;padding:24px;color:#111}
  h1{font-size:18px;margin:0 0 6px}
  .meta{font-size:12px;color:#555;margin-bottom:16px;line-height:1.8}
  table{width:100%;border-collapse:collapse;font-size:12px}
  th,td{border:1px solid #ccc;padding:8px;vertical-align:top;text-align:right}
  th{background:#f3f3f3}
</style>
</head>
<body>
  <h1>${title}</h1>
  <div class="meta">
    کد کاربر: ${report.user_code || "—"} —
    موبایل: <span dir="ltr">${report.phone_number || ""}</span><br/>
    تعداد رکورد: ${fa(report.total || 0)} —
    مرتب‌سازی: ${report.sort === "asc" ? "قدیم → جدید" : "جدید → قدیم"}
    ${report.date_from || report.date_to ? `<br/>بازه: ${report.date_from || "…"} تا ${report.date_to || "…"}` : ""}
  </div>
  <table>
    <thead>
      <tr>
        <th>#</th><th>تاریخ</th><th>نسخه</th><th>IP</th><th>دستگاه</th><th>امضا (hash)</th><th>فراداده</th>
      </tr>
    </thead>
    <tbody>${rows || `<tr><td colspan="7">موردی یافت نشد</td></tr>`}</tbody>
  </table>
</body>
</html>`;
}

/**
 * Admin report card for a user's permanent login terms signatures.
 */
export default function TermsSignaturesReportModal({ userId, userLabel, onClose }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [report, setReport] = useState(null);
  const [sort, setSort] = useState("desc");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [expandedId, setExpandedId] = useState(null);

  async function load(next = {}) {
    setLoading(true);
    setError("");
    try {
      const res = await fetchUserTermsAcceptances(userId, {
        dateFrom: next.dateFrom ?? dateFrom,
        dateTo: next.dateTo ?? dateTo,
        sort: next.sort ?? sort,
      });
      setReport(res);
    } catch (err) {
      setError(err.message || "بارگذاری گزارش با خطا مواجه شد");
      setReport(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const items = report?.items || [];

  const subtitle = useMemo(() => {
    if (!report) return userLabel || "";
    return `${report.full_name || "بدون نام"} — ${report.phone_number} — کد ${report.user_code}`;
  }, [report, userLabel]);

  function handleApplyFilters(e) {
    e?.preventDefault?.();
    load({ dateFrom, dateTo, sort });
  }

  function handleExportCsv() {
    if (!report) return;
    const name = `terms-signatures-${report.user_code || userId}-${sort}.csv`;
    downloadBlob(name, buildCsv(report), "text/csv;charset=utf-8");
  }

  function handleExportPrint() {
    if (!report) return;
    const html = buildPrintHtml(report);
    const w = window.open("", "_blank");
    if (!w) {
      downloadBlob(
        `terms-signatures-${report.user_code || userId}.html`,
        html,
        "text/html;charset=utf-8"
      );
      return;
    }
    w.document.open();
    w.document.write(html);
    w.document.close();
    setTimeout(() => {
      try {
        w.focus();
        w.print();
      } catch {
        /* ignore */
      }
    }, 300);
  }

  return (
    <div
      className="modal-backdrop sig-report-backdrop"
      onClick={(e) => {
        e.stopPropagation();
        onClose();
      }}
    >      <div
        className="sig-report"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sig-report-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-sheet__handle" />
        <div className="sig-report__header">
          <div>
            <h2 id="sig-report-title" className="sig-report__title">
              امضای دیجیتال ورود کاربر
            </h2>
            <p className="sig-report__subtitle">{subtitle}</p>
          </div>
          <button type="button" className="sig-report__close" onClick={onClose}>
            بستن
          </button>
        </div>

        <form className="sig-report__filters" onSubmit={handleApplyFilters}>
          <label className="sig-report__field">
            <span>از تاریخ</span>
            <JalaliDateInput value={dateFrom} onChange={setDateFrom} />
          </label>
          <label className="sig-report__field">
            <span>تا تاریخ</span>
            <JalaliDateInput value={dateTo} onChange={setDateTo} />
          </label>
          <label className="sig-report__field">
            <span>مرتب‌سازی</span>
            <select
              className="field__input"
              value={sort}
              onChange={(e) => setSort(e.target.value)}
            >
              <option value="desc">جدید → قدیم</option>
              <option value="asc">قدیم → جدید</option>
            </select>
          </label>
          <button type="submit" className="modal-btn modal-btn--buy sig-report__apply" disabled={loading}>
            اعمال فیلتر
          </button>
        </form>

        <div className="sig-report__toolbar">
          <span className="sig-report__count">
            {loading ? "در حال بارگذاری…" : `${fa(report?.total || 0)} رکورد`}
          </span>
          <div className="sig-report__exports">
            <button type="button" className="sig-report__export-btn" onClick={handleExportCsv} disabled={!items.length}>
              خروجی CSV / اکسل
            </button>
            <button type="button" className="sig-report__export-btn" onClick={handleExportPrint} disabled={!items.length}>
              چاپ / PDF
            </button>
          </div>
        </div>

        {error && <p className="field__error">{error}</p>}

        <div className="sig-report__table-wrap">
          {!loading && items.length === 0 ? (
            <p className="myorders__empty">در این بازه امضایی ثبت نشده</p>
          ) : (
            <table className="sig-report__table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>تاریخ پذیرش</th>
                  <th>نسخه</th>
                  <th>IP</th>
                  <th>دستگاه</th>
                  <th>جزئیات</th>
                </tr>
              </thead>
              <tbody>
                {items.map((row, idx) => {
                  const open = expandedId === row.id;
                  return (
                    <Fragment key={row.id}>
                      <tr>
                        <td>{fa(idx + 1)}</td>
                        <td>{formatDate(row.accepted_at)}</td>
                        <td>{row.terms_version}</td>
                        <td dir="ltr">{row.ip_address || "—"}</td>
                        <td dir="ltr" className="sig-report__mono">
                          {row.device_id ? `${String(row.device_id).slice(0, 10)}…` : "—"}
                        </td>
                        <td>
                          <button
                            type="button"
                            className="sig-report__detail-btn"
                            onClick={() => setExpandedId(open ? null : row.id)}
                          >
                            {open ? "بستن" : "نمایش"}
                          </button>
                        </td>
                      </tr>
                      {open && (
                        <tr className="sig-report__detail-row">
                          <td colSpan={6}>
                            <div className="sig-report__detail">
                              <div>
                                <strong>امضای دیجیتال:</strong>
                                <code dir="ltr">{row.signature_hash}</code>
                              </div>
                              <div>
                                <strong>hash متن قوانین:</strong>
                                <code dir="ltr">{row.terms_content_hash}</code>
                              </div>
                              <div>
                                <strong>شناسه دستگاه:</strong>
                                <code dir="ltr">{row.device_id}</code>
                              </div>
                              {row.user_agent && (
                                <div>
                                  <strong>User-Agent:</strong>
                                  <span>{row.user_agent}</span>
                                </div>
                              )}
                              {fingerprintSummary(row.fingerprint) && (
                                <div>
                                  <strong>فراداده:</strong>
                                  <span>{fingerprintSummary(row.fingerprint)}</span>
                                </div>
                              )}
                              {row.accepted_at_client && (
                                <div>
                                  <strong>زمان کلاینت:</strong>
                                  <span>{formatDate(row.accepted_at_client)}</span>
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
