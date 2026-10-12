// Cash balance formatting shared between the admin panel and the user's
// own account view.
//
// Negative balance = بدهکار (customer owes the shop) -> label RED.
// Positive balance = بستانکار (shop owes the customer) -> label GREEN.
// Amount numbers stay blue in the UI; only the status word is colored.

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

// Same بدهکار / بستانکار labels for gold weight (بدهکار red, بستانکار green).
export function formatGoldStatus(goldBalance) {
  const amount = Math.abs(goldBalance).toLocaleString("en-US", { maximumFractionDigits: 3 });

  if (goldBalance < 0) {
    return { label: "بدهکار", amount, className: "cash-status--debtor" };
  }
  if (goldBalance > 0) {
    return { label: "بستانکار", amount, className: "cash-status--creditor" };
  }
  return { label: "تسویه", amount: "۰", className: "cash-status--settled" };
}