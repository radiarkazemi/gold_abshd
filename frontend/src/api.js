const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:8000";
const WS_BASE = API_BASE.replace(/^http/, "ws");
import { getDeviceId, getDeviceInfo } from "./utils/deviceId";
import { decodePayload } from "./utils/payloadCodec";
const TOKEN_KEY = "goldapp_token";

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

const ADMIN_TOKEN_KEY = "goldapp_admin_token";
const ADMIN_IDENTITY_KEY = "goldapp_admin_identity";

export function getAdminToken() {
  return localStorage.getItem(ADMIN_TOKEN_KEY);
}

export function setAdminToken(token) {
  localStorage.setItem(ADMIN_TOKEN_KEY, token);
}

export function clearAdminToken() {
  localStorage.removeItem(ADMIN_TOKEN_KEY);
  localStorage.removeItem(ADMIN_IDENTITY_KEY);
}

export function setAdminIdentity(identity) {
  localStorage.setItem(ADMIN_IDENTITY_KEY, JSON.stringify(identity));
}

export function getAdminIdentity() {
  try {
    const raw = localStorage.getItem(ADMIN_IDENTITY_KEY);
    return raw ? JSON.parse(raw) : { is_super: true, permissions: [], display_name: "" };
  } catch {
    return { is_super: true, permissions: [], display_name: "" };
  }
}

function adminAuthHeaders() {
  const token = getAdminToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function adminLogin(username, password) {
  const res = await fetch(`${API_BASE}/api/admin/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "ورود ناموفق بود");
  }
  const data = await res.json();
  setAdminIdentity({ is_super: data.is_super, permissions: data.permissions, display_name: data.display_name });
  return data;
}

export async function adminVerify(adminUserId, code, registrationKey) {
  const res = await fetch(`${API_BASE}/api/admin/auth/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ admin_user_id: adminUserId, code, registration_key: registrationKey || null }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "تایید ناموفق بود");
  }
  const data = await res.json();
  setAdminIdentity({ is_super: data.is_super, permissions: data.permissions, display_name: data.display_name });
  return data;
}

export async function fetchKycStatus() {
  const res = await fetch(`${API_BASE}/api/kyc/status`, { headers: { ...authHeaders() } });
  if (!res.ok) throw new Error("Failed to fetch KYC status");
  return res.json();
}

export async function submitKyc(file) {
  const formData = new FormData();
  formData.append("file", file);
  const res = await fetch(`${API_BASE}/api/kyc/submit`, {
    method: "POST",
    headers: { ...authHeaders() },
    body: formData,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "ارسال مدرک با خطا مواجه شد");
  }
  return res.json();
}

export async function fetchMyTransfers() {
  const res = await fetch(`${API_BASE}/api/my/transfers`, { headers: { ...authHeaders() } });
  if (!res.ok) throw new Error("Failed to fetch transfers");
  return res.json();
}

export async function submitTransfer({ amount, bank_reference, transfer_date, description, file }) {
  const formData = new FormData();
  formData.append("amount", amount);
  formData.append("bank_reference", bank_reference || "");
  formData.append("transfer_date", transfer_date || "");
  formData.append("description", description || "");
  if (file) formData.append("file", file);
  const res = await fetch(`${API_BASE}/api/transfers`, {
    method: "POST",
    headers: { ...authHeaders() },
    body: formData,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "ثبت حواله با خطا مواجه شد");
  }
  return res.json();
}

export async function fetchAdminKycPending() {
  const res = await fetch(`${API_BASE}/api/admin/kyc/pending`, { headers: { ...adminAuthHeaders() } });
  if (!res.ok) throw new Error("Failed to fetch pending KYC");
  return res.json();
}

export async function reviewKyc(userId, approve, rejectReason) {
  const res = await fetch(`${API_BASE}/api/admin/kyc/${userId}/review`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...adminAuthHeaders() },
    body: JSON.stringify({ approve, reject_reason: rejectReason || null }),
  });
  if (!res.ok) throw new Error("Failed to review KYC");
  return res.json();
}

export async function fetchKycDocumentBlobUrlAsAdmin(userId) {
  const res = await fetch(`${API_BASE}/api/admin/kyc/${userId}/document`, { headers: { ...adminAuthHeaders() } });
  if (!res.ok) throw new Error("Failed to fetch document");
  const blob = await res.blob();
  return { url: URL.createObjectURL(blob), contentType: blob.type };
}

export async function fetchAdminTransfers(status) {
  const url = new URL(`${API_BASE}/api/admin/transfers`);
  if (status) url.searchParams.set("status", status);
  const res = await fetch(url, { headers: { ...adminAuthHeaders() } });
  if (!res.ok) throw new Error("Failed to fetch transfers");
  return res.json();
}

export async function decideTransfer(transferId, accept, adminNote) {
  const res = await fetch(`${API_BASE}/api/admin/transfers/${transferId}/decide`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...adminAuthHeaders() },
    body: JSON.stringify({ accept, admin_note: adminNote || "" }),
  });
  if (!res.ok) throw new Error("Failed to decide transfer");
  return res.json();
}

export async function fetchTransferReceiptBlobUrlAsAdmin(transferId) {
  const res = await fetch(`${API_BASE}/api/admin/transfers/${transferId}/receipt`, { headers: { ...adminAuthHeaders() } });
  if (!res.ok) throw new Error("Failed to fetch receipt");
  const blob = await res.blob();
  return { url: URL.createObjectURL(blob), contentType: blob.type };
}

function authHeaders() {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function requestOtp(phoneNumber, registrationKey) {
  const res = await fetch(`${API_BASE}/api/auth/request-otp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      phone_number: phoneNumber,
      device_id: getDeviceId(),
      registration_key: registrationKey || null,
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Failed to request OTP");
  }
  return res.json();
}

export async function verifyOtp(phoneNumber, code, registrationKey) {
  const res = await fetch(`${API_BASE}/api/auth/verify-otp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      phone_number: phoneNumber,
      code,
      device_id: getDeviceId(),
      registration_key: registrationKey || null,
      device_info: getDeviceInfo(),
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Failed to verify OTP");
  }
  return res.json();
}

export async function fetchMe() {
  const res = await fetch(`${API_BASE}/api/auth/me`, {
    headers: { ...authHeaders() },
  });
  if (!res.ok) throw new Error("Not authenticated");
  return res.json();
}

export async function fetchPrice() {
  const res = await fetch(`${API_BASE}/api/price`);
  if (!res.ok) throw new Error("Failed to fetch price");
  const { payload } = await res.json();
  return decodePayload(payload);
}

export async function fetchOrderLimits() {
  const res = await fetch(`${API_BASE}/api/order-limits`, { headers: { ...authHeaders() } });
  if (!res.ok) throw new Error("Failed to fetch order limits");
  return res.json();
}

export async function updateOrderLimits(payload) {
  const res = await fetch(`${API_BASE}/api/admin/order-limits`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...adminAuthHeaders() },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error("Failed to update order limits");
  return res.json();
}

export async function cancelMyOrder(orderId) {
  const res = await fetch(`${API_BASE}/api/my/orders/${orderId}/cancel`, {
    method: "POST",
    headers: { ...authHeaders() },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Failed to cancel order");
  }
  return res.json();
}

export async function fetchMyOrderDetail(orderId) {
  const res = await fetch(`${API_BASE}/api/my/orders/${orderId}`, {
    headers: { ...authHeaders() },
  });
  if (!res.ok) throw new Error("Failed to fetch order");
  return res.json();
}

export async function fetchMyOrders() {
  const res = await fetch(`${API_BASE}/api/my/orders`, {
    headers: { ...authHeaders() },
  });
  if (!res.ok) throw new Error("Failed to fetch my orders");
  return res.json();
}

export async function fetchMyTransactions() {
  const res = await fetch(`${API_BASE}/api/my/transactions`, {
    headers: { ...authHeaders() },
  });
  if (!res.ok) throw new Error("Failed to fetch transactions");
  return res.json();
}

export async function fetchMyBalance() {
  const res = await fetch(`${API_BASE}/api/my/balance`, {
    headers: { ...authHeaders() },
  });
  if (!res.ok) throw new Error("Failed to fetch balance");
  return res.json();
}

export async function submitOrder({ goldbridgeItemId, side, amountType, value, description }) {
  const res = await fetch(`${API_BASE}/api/orders`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({
      goldbridge_item_id: goldbridgeItemId,
      side,
      amount_type: amountType,
      value,
      description,
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Failed to submit order");
  }
  return res.json();
}

export async function uploadReceipt(orderId, file) {
  const formData = new FormData();
  formData.append("file", file);
  const res = await fetch(`${API_BASE}/api/orders/${orderId}/receipt`, {
    method: "POST",
    headers: { ...authHeaders() }, // NOTE: no Content-Type - browser sets the multipart boundary itself
    body: formData,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Failed to upload receipt");
  }
  return res.json();
}

export async function fetchReceiptBlobUrl(orderId) {
  const res = await fetch(`${API_BASE}/api/orders/${orderId}/receipt`, {
    headers: { ...authHeaders() },
  });
  if (!res.ok) throw new Error("Failed to fetch receipt");
  const blob = await res.blob();
  return { url: URL.createObjectURL(blob), contentType: blob.type };
}

export async function fetchReceiptBlobUrlAsAdmin(orderId) {
  const res = await fetch(`${API_BASE}/api/admin/orders/${orderId}/receipt`, {
    headers: { ...adminAuthHeaders() },
  });
  if (!res.ok) throw new Error("Failed to fetch receipt");
  const blob = await res.blob();
  return { url: URL.createObjectURL(blob), contentType: blob.type };
}

export async function fetchOrder(orderId) {
  const res = await fetch(`${API_BASE}/api/orders/${orderId}`);
  if (!res.ok) throw new Error("Failed to fetch order");
  return res.json();
}

export async function fetchOrders(status) {
  const url = new URL(`${API_BASE}/api/admin/orders`);
  if (status) url.searchParams.set("status", status);
  const res = await fetch(url, { headers: { ...adminAuthHeaders() } });
  if (res.status === 401 || res.status === 403) {
    clearAdminToken();
    throw new Error("ADMIN_SESSION_EXPIRED");
  }
  if (!res.ok) throw new Error("Failed to fetch orders");
  return res.json();
}

export async function decideOrder(orderId, status) {
  const res = await fetch(`${API_BASE}/api/admin/orders/${orderId}/decide`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...adminAuthHeaders() },
    body: JSON.stringify({ status }),
  });
  if (!res.ok) throw new Error("Failed to update order");
  return res.json();
}

export async function fetchAdminUsers(search) {
  const url = new URL(`${API_BASE}/api/admin/users`);
  if (search) url.searchParams.set("search", search);
  const res = await fetch(url, { headers: { ...adminAuthHeaders() } });
  if (!res.ok) throw new Error("Failed to fetch users");
  return res.json();
}

export async function fetchAdminPriceCards() {
  const res = await fetch(`${API_BASE}/api/admin/price-cards`, { headers: { ...adminAuthHeaders() } });
  if (!res.ok) throw new Error("Failed to fetch price cards");
  return res.json();
}

export async function setPriceCardEnabled(goldbridgeItemId, isEnabled, extra = {}) {
  const res = await fetch(`${API_BASE}/api/admin/price-cards/${goldbridgeItemId}/enabled`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...adminAuthHeaders() },
    body: JSON.stringify({
      is_enabled: isEnabled,
      display_name: extra.displayName ?? null,
      sort_order: extra.sortOrder ?? null,
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Failed to update card");
  }
  return res.json();
}

export async function setPriceCardOverride(goldbridgeItemId, override) {
  const res = await fetch(`${API_BASE}/api/admin/price-cards/${goldbridgeItemId}/override`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...adminAuthHeaders() },
    body: JSON.stringify({ override_source_restriction: override }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Failed to update override");
  }
  return res.json();
}

export async function setPriceCardOrderable(goldbridgeItemId, orderableBuy, orderableSell) {
  const res = await fetch(`${API_BASE}/api/admin/price-cards/${goldbridgeItemId}/orderable`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...adminAuthHeaders() },
    body: JSON.stringify({ orderable_buy: orderableBuy, orderable_sell: orderableSell }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Failed to update orderable state");
  }
  return res.json();
}

export async function fetchAllPrices() {
  const res = await fetch(`${API_BASE}/api/admin/all-prices`, {
    headers: { ...adminAuthHeaders() },
  });
  if (res.status === 401 || res.status === 403) {
    clearAdminToken();
    throw new Error("ADMIN_SESSION_EXPIRED");
  }
  if (!res.ok) throw new Error("Failed to fetch prices");
  const { payload } = await res.json();
  return decodePayload(payload);
}

export async function fetchPermissionScopes() {
  const res = await fetch(`${API_BASE}/api/admin/admins/permission-scopes`, {
    headers: { ...adminAuthHeaders() },
  });
  if (!res.ok) throw new Error("Failed to fetch permission scopes");
  return res.json();
}

export async function fetchSubAdmins() {
  const res = await fetch(`${API_BASE}/api/admin/admins`, {
    headers: { ...adminAuthHeaders() },
  });
  if (!res.ok) throw new Error("Failed to fetch admin users");
  return res.json();
}

export async function createSubAdmin(payload) {
  const res = await fetch(`${API_BASE}/api/admin/admins`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...adminAuthHeaders() },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Failed to create admin user");
  }
  return res.json();
}

export async function updateSubAdmin(adminUserId, payload) {
  const res = await fetch(`${API_BASE}/api/admin/admins/${adminUserId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...adminAuthHeaders() },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Failed to update admin user");
  }
  return res.json();
}

export async function deleteSubAdmin(adminUserId) {
  const res = await fetch(`${API_BASE}/api/admin/admins/${adminUserId}`, {
    method: "DELETE",
    headers: { ...adminAuthHeaders() },
  });
  if (!res.ok) throw new Error("Failed to delete admin user");
  return res.json();
}

export async function fetchAdminActivity(limit = 200) {
  const res = await fetch(`${API_BASE}/api/admin/admins/activity?limit=${limit}`, {
    headers: { ...adminAuthHeaders() },
  });
  if (!res.ok) throw new Error("Failed to fetch admin activity");
  return res.json();
}

export async function fetchAdminUserDetail(userId) {
  const res = await fetch(`${API_BASE}/api/admin/users/${userId}`, {
    headers: { ...adminAuthHeaders() },
  });
  if (!res.ok) throw new Error("Failed to fetch user detail");
  return res.json();
}

export async function adjustUserBalance(userId, { goldChange, cashChange, note }) {
  const res = await fetch(`${API_BASE}/api/admin/users/${userId}/adjust-balance`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...adminAuthHeaders() },
    body: JSON.stringify({ gold_change: goldChange, cash_change: cashChange, note }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Failed to adjust balance");
  }
  return res.json();
}

export async function setUserBlocked(userId, isBlocked) {
  const res = await fetch(`${API_BASE}/api/admin/users/${userId}/block`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...adminAuthHeaders() },
    body: JSON.stringify({ is_blocked: isBlocked }),
  });
  if (!res.ok) throw new Error("Failed to update block status");
  return res.json();
}

export async function fetchNotice() {
  const res = await fetch(`${API_BASE}/api/notice`);
  if (!res.ok) throw new Error("Failed to fetch notice");
  return res.json();
}

export async function updateNotice(text) {
  const res = await fetch(`${API_BASE}/api/admin/notice`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...adminAuthHeaders() },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) throw new Error("Failed to update notice");
  return res.json();
}

export async function fetchRoles() {
  const res = await fetch(`${API_BASE}/api/admin/roles`, {
    headers: { ...adminAuthHeaders() },
  });
  if (!res.ok) throw new Error("Failed to fetch roles");
  return res.json();
}

export async function createRole(name, commissionType, commissionValue, extra = {}) {
  const res = await fetch(`${API_BASE}/api/admin/roles`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...adminAuthHeaders() },
    body: JSON.stringify({
      name, commission_type: commissionType, commission_value: commissionValue,
      min_weight: extra.minWeight ?? null, max_weight: extra.maxWeight ?? null,
      min_amount: extra.minAmount ?? null, max_amount: extra.maxAmount ?? null,
      price_label_mode: extra.priceLabelMode || "mesghal_and_gram18",
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Failed to create role");
  }
  return res.json();
}

export async function updateRoleCommission(roleId, commissionType, commissionValue, extra = {}) {
  const res = await fetch(`${API_BASE}/api/admin/roles/${roleId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...adminAuthHeaders() },
    body: JSON.stringify({
      commission_type: commissionType, commission_value: commissionValue,
      min_weight: extra.minWeight ?? null, max_weight: extra.maxWeight ?? null,
      min_amount: extra.minAmount ?? null, max_amount: extra.maxAmount ?? null,
      price_label_mode: extra.priceLabelMode ?? null,
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Failed to update role");
  }
  return res.json();
}

export async function createUserAdmin({ phoneNumber, fullName, roleId, nationalId, notes, keyTtlDays }) {
  const res = await fetch(`${API_BASE}/api/admin/users`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...adminAuthHeaders() },
    body: JSON.stringify({
      phone_number: phoneNumber,
      full_name: fullName,
      role_id: roleId,
      national_id: nationalId || null,
      notes: notes || null,
      key_ttl_days: keyTtlDays || 14,
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Failed to create user");
  }
  return res.json();
}

export async function updateUserAdmin(userId, { fullName, roleId, nationalId, notes }) {
  const res = await fetch(`${API_BASE}/api/admin/users/${userId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...adminAuthHeaders() },
    body: JSON.stringify({
      full_name: fullName,
      role_id: roleId,
      national_id: nationalId,
      notes: notes,
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Failed to update user");
  }
  return res.json();
}

export async function fetchTradingStatus() {
  const res = await fetch(`${API_BASE}/api/trading-status`);
  if (!res.ok) throw new Error("Failed to fetch trading status");
  return res.json();
}

export async function updateTradingStatus(isOnline) {
  const res = await fetch(`${API_BASE}/api/admin/trading-status`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...adminAuthHeaders() },
    body: JSON.stringify({ is_online: isOnline }),
  });
  if (!res.ok) throw new Error("Failed to update trading status");
  return res.json();
}

export async function fetchSettlementLabel() {
  const res = await fetch(`${API_BASE}/api/settlement-label`);
  if (!res.ok) throw new Error("Failed to fetch settlement label");
  return res.json();
}

export async function fetchHolidays() {
  const res = await fetch(`${API_BASE}/api/admin/holidays`, {
    headers: { ...adminAuthHeaders() },
  });
  if (!res.ok) throw new Error("Failed to fetch holidays");
  return res.json();
}

export async function addHoliday(date, description) {
  const res = await fetch(`${API_BASE}/api/admin/holidays`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...adminAuthHeaders() },
    body: JSON.stringify({ date, description }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Failed to add holiday");
  }
  return res.json();
}

export async function deleteHoliday(holidayId) {
  const res = await fetch(`${API_BASE}/api/admin/holidays/${holidayId}`, {
    method: "DELETE",
    headers: { ...adminAuthHeaders() },
  });
  if (!res.ok) throw new Error("Failed to delete holiday");
  return res.json();
}

export async function createPhoneOrder({ userId, side, amountType, value, mesghal17Price, description }) {
  const res = await fetch(`${API_BASE}/api/admin/orders/phone`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...adminAuthHeaders() },
    body: JSON.stringify({
      user_id: userId,
      side,
      amount_type: amountType,
      value,
      mesghal17_price: mesghal17Price,
      description,
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Failed to create phone order");
  }
  return res.json();
}

export function openAdminSocket(onMessage) {
  const token = getAdminToken();
  const ws = new WebSocket(`${WS_BASE}/ws/admin?token=${encodeURIComponent(token || "")}`);
  ws.onmessage = (event) => {
    try {
      onMessage(JSON.parse(event.data));
    } catch (e) {
      console.error("Bad admin payload", e);
    }
  };
  return ws;
}

export function openPriceSocket(onPrice) {
  const ws = new WebSocket(`${WS_BASE}/ws/price`);
  ws.onmessage = (event) => {
    try {
      const { payload } = JSON.parse(event.data);
      onPrice(decodePayload(payload));
    } catch (e) {
      console.error("Bad price payload", e);
    }
  };
  return ws;
}

export { API_BASE, WS_BASE };