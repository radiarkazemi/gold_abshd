// Cash balance formatting shared between the admin panel and the user's
// own account view.
//
// Convention (as specified): negative balance = بدهکار (customer owes
// the shop) -> shown GREEN. Positive balance = بستانکار (shop owes the
// customer) -> shown RED. This is intentionally the reverse of the
// "debt=red" convention you might expect from general accounting -
// it's what was explicitly requested.

export function formatCashStatus(cashBalance) {
  const amount = Math.abs(Math.round(cashBalance));
  const formatted = amount.toLocaleString("en-US");

  if (cashBalance < 0) {
    return { label: "بدهکار", amount: formatted, className: "cash-status--debtor" };
  }
  if (cashBalance > 0) {
    return { label: "بستانکار", amount: formatted, className: "cash-status--creditor" };
  }
  return { label: "تسویه", amount: "۰", className: "cash-status--settled" };
}

// Same بدهکار concept applied to gold weight, but only for the NEGATIVE
// case (the customer somehow owes gold back - e.g. a sell was accepted
// ahead of a matching buy). A normal positive gold holding is just the
// customer's own asset, not a "creditor" situation, so it stays in the
// plain gold color rather than getting flagged red - only the negative
// (problem) state gets the alert treatment.
export function formatGoldStatus(goldBalance) {
  const amount = Math.abs(goldBalance).toLocaleString("en-US", { maximumFractionDigits: 3 });

  if (goldBalance < 0) {
    return { label: "بدهکار", amount, className: "cash-status--debtor" };
  }
  return { label: null, amount, className: "" };
}