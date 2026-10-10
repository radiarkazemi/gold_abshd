import { useEffect, useMemo, useState } from "react";
import { orderGoldWeight } from "../utils/orderCalc";
import { formatTehranDateTime, serverDateMs, tehranDayKey } from "../utils/tehranTime";

/** Shop-centric labels (what we did), not customer-centric. */
const SIDE_LABEL = {
  buy: "فروش به مشتری", // customer bought from us
  sell: "خرید از مشتری", // we bought from customer
};
const HEDGE_LABEL = {
  buy_from_dealer: "خرید از آبشده تهران",
  sell_to_dealer: "فروش به آبشده تهران",
};

/** One-line flow: خرید از مشتری → فروش به تهران */
function flowLabel(orderSide, hedgeSide) {
  const left = SIDE_LABEL[orderSide] || orderSide || "—";
  const right = HEDGE_LABEL[hedgeSide] || hedgeSide || "—";
  if (!orderSide) return right;
  return `${left} → ${right}`;
}

const PAGE_SIZE = 12;

function fa(n, opts) {
  if (n == null || Number.isNaN(Number(n))) return "—";
  return Number(n).toLocaleString("fa-IR", opts);
}

export function buildTehranLedger({ hedges = [], acceptedOrders = [], dayKey = null } = {}) {
  const rows = [];
  const hedgedOrderIds = new Set();
  for (const h of hedges) {
    if (dayKey && tehranDayKey(h.created_at) !== dayKey) continue;
    if (h.related_order_id) hedgedOrderIds.add(h.related_order_id);
    rows.push({
      kind: "hedge",
      sortAt: serverDateMs(h.created_at),
      key: `hedge-${h.id}`,
      hedge: h,
    });
  }
  for (const o of acceptedOrders) {
    const at = o.updated_at || o.created_at;
    if (dayKey && tehranDayKey(at) !== dayKey) continue;
    // Fully covered orders already appear as تخصیص rows — skip duplicate «تایید» line.
    const open = Math.max(0, Number(o.open_hedge_weight ?? 0));
    if (open <= 1e-6 && hedgedOrderIds.has(o.id)) continue;
    rows.push({
      kind: "accepted",
      sortAt: serverDateMs(at),
      key: `accepted-${o.id}`,
      order: o,
    });
  }
  rows.sort((a, b) => b.sortAt - a.sortAt || String(b.key).localeCompare(String(a.key)));
  return rows;
}

export default function ExpertTehranLedger({
  hedges,
  acceptedOrders,
  dayKey,
  emptyText,
  onRemoveHedge,
  allowDelete = true,
}) {
  const [page, setPage] = useState(0);
  const ledger = useMemo(
    () => buildTehranLedger({ hedges, acceptedOrders, dayKey }),
    [hedges, acceptedOrders, dayKey]
  );
  const pageCount = Math.max(1, Math.ceil(ledger.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const paged = useMemo(() => {
    const start = safePage * PAGE_SIZE;
    return ledger.slice(start, start + PAGE_SIZE);
  }, [ledger, safePage]);

  useEffect(() => {
    setPage(0);
  }, [dayKey, hedges, acceptedOrders]);

  useEffect(() => {
    if (page > pageCount - 1) setPage(Math.max(0, pageCount - 1));
  }, [page, pageCount]);

  if (ledger.length === 0) {
    return (
      <div className="expert-empty expert-empty--inline">
        <strong>{emptyText || "ردیفی برای این روز نیست"}</strong>
      </div>
    );
  }

  return (
    <div className="expert-hedges__table-wrap">
      <table className="expert-hedges__table expert-hedges__table--wide">
        <thead>
          <tr>
            <th>زمان</th>
            <th>رویداد / جریان</th>
            <th className="expert-hedges__th--buy">
              وزن سفارش
              <br />
              (فروش به مشتری)
            </th>
            <th className="expert-hedges__th--sell">
              وزن سفارش
              <br />
              (خرید از مشتری)
            </th>
            <th>فی مشتری</th>
            <th>معامله تهران</th>
            <th>آبشده‌فروش</th>
            <th>وزن تخصیص</th>
            <th>فی تهران</th>
            <th>یادداشت</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {paged.map((row) => {
            if (row.kind === "accepted") {
              const o = row.order;
              const open = Math.max(0, Number(o.open_hedge_weight || 0));
              const w = o.weight_gram18 ?? orderGoldWeight(o);
              const wLabel = `${fa(w, { maximumFractionDigits: 3 })} g`;
              return (
                <tr
                  key={row.key}
                  className={open > 1e-6 ? "expert-hedges__row--open" : "expert-hedges__row--accepted"}
                >
                  <td>{formatTehranDateTime(o.updated_at || o.created_at)}</td>
                  <td>
                    <div className="expert-hedges__order">
                      <strong>
                        {o.customer_name || "بدون نام"} #{o.customer_code}
                      </strong>
                      <span>
                        تایید · {SIDE_LABEL[o.side] || o.side}
                        {open > 1e-6 ? " · هنوز پوشش تهران ناقص" : " · پوشش تهران انجام شد"}
                      </span>
                    </div>
                  </td>
                  <td className="expert-hedges__w--buy">{o.side === "buy" ? wLabel : "—"}</td>
                  <td className="expert-hedges__w--sell">{o.side === "sell" ? wLabel : "—"}</td>
                  <td>
                    {o.mesghal17_price_at_submit != null
                      ? fa(Math.round(o.mesghal17_price_at_submit))
                      : "—"}
                  </td>
                  <td colSpan={3}>
                    {open > 1e-6
                      ? `مانده برای تهران: ${fa(open, { maximumFractionDigits: 3 })} g`
                      : "—"}
                  </td>
                  <td>—</td>
                  <td>—</td>
                  <td></td>
                </tr>
              );
            }

            const h = row.hedge;
            const o = h.related_order;
            const ow = o ? `${fa(o.weight_gram18, { maximumFractionDigits: 3 })} g` : null;
            return (
              <tr key={row.key}>
                <td>{formatTehranDateTime(h.created_at)}</td>
                <td>
                  {o ? (
                    <div className="expert-hedges__order">
                      <strong>
                        {o.customer_name || "بدون نام"} #{o.customer_code}
                      </strong>
                      <span>
                        پوشش تهران · {flowLabel(o.side, h.side)}
                        {o.status === "accepted"
                          ? " · تاییدشده"
                          : o.status === "pending"
                            ? " · در انتظار"
                            : ""}
                      </span>
                    </div>
                  ) : (
                    <div className="expert-hedges__order">
                      <strong>پوشش آزاد</strong>
                      <span>{HEDGE_LABEL[h.side] || h.side}</span>
                    </div>
                  )}
                </td>
                <td className="expert-hedges__w--buy">{o?.side === "buy" && ow ? ow : "—"}</td>
                <td className="expert-hedges__w--sell">{o?.side === "sell" && ow ? ow : "—"}</td>
                <td>
                  {o?.mesghal17_price_at_submit != null
                    ? fa(Math.round(o.mesghal17_price_at_submit))
                    : "—"}
                </td>
                <td>{HEDGE_LABEL[h.side] || h.side}</td>
                <td>
                  {h.dealer_name}
                  {h.dealer_moshtari_id != null ? (
                    <div className="expert-hedges__order">
                      <span>کد ته‌حساب {h.dealer_moshtari_id}</span>
                      {h.tahesab_factor_code
                        ? <span> · سند شد</span>
                        : h.tahesab_sync_needed
                          ? <span> · در صف ته‌حساب</span>
                          : null}
                    </div>
                  ) : (
                    <div className="expert-hedges__order">
                      <span>بدون کد ته‌حساب</span>
                    </div>
                  )}
                </td>
                <td>{fa(h.weight_gram18, { maximumFractionDigits: 3 })} g</td>
                <td>{h.price_mesghal17 != null ? fa(Math.round(h.price_mesghal17)) : "—"}</td>
                <td>{h.note || "—"}</td>
                <td>
                  {allowDelete && (
                    <button
                      type="button"
                      className="expert-btn expert-btn--no"
                      onClick={() => onRemoveHedge?.(h.id)}
                    >
                      حذف
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {ledger.length > PAGE_SIZE && (
        <div className="expert-hedges__pager">
          <button
            type="button"
            className="expert-btn"
            disabled={safePage <= 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
          >
            قبلی
          </button>
          <span>
            صفحه {fa(safePage + 1)} از {fa(pageCount)} · {fa(ledger.length)} ردیف
          </span>
          <button
            type="button"
            className="expert-btn"
            disabled={safePage >= pageCount - 1}
            onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
          >
            بعدی
          </button>
        </div>
      )}
    </div>
  );
}
