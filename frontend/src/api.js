const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:8000";
const WS_BASE = API_BASE.replace(/^http/, "ws");
import { getDeviceId, getDeviceInfo } from "./utils/deviceId";
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

export function getAdminToken() {
  return localStorage.getItem(ADMIN_TOKEN_KEY);
}

export function setAdminToken(token) {
  localStorage.setItem(ADMIN_TOKEN_KEY, token);
}

export function clearAdminToken() {
  localStorage.removeItem(ADMIN_TOKEN_KEY);
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
  return res.json();
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
  return res.json();
}

export async function fetchOrderLimits() {
  const res = await fetch(`${API_BASE}/api/order-limits`);
  if (!res.ok) throw new Error("Failed to fetch order limits");
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

export async function fetchMyBalance() {
  const res = await fetch(`${API_BASE}/api/my/balance`, {
    headers: { ...authHeaders() },
  });
  if (!res.ok) throw new Error("Failed to fetch balance");
  return res.json();
}

export async function submitOrder({ side, amountType, value, description }) {
  const res = await fetch(`${API_BASE}/api/orders`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({
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

export async function createRole(name, commissionType, commissionValue) {
  const res = await fetch(`${API_BASE}/api/admin/roles`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...adminAuthHeaders() },
    body: JSON.stringify({ name, commission_type: commissionType, commission_value: commissionValue }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Failed to create role");
  }
  return res.json();
}

export async function updateRoleCommission(roleId, commissionType, commissionValue) {
  const res = await fetch(`${API_BASE}/api/admin/roles/${roleId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...adminAuthHeaders() },
    body: JSON.stringify({ commission_type: commissionType, commission_value: commissionValue }),
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
      onPrice(JSON.parse(event.data));
    } catch (e) {
      console.error("Bad price payload", e);
    }
  };
  return ws;
}

export { API_BASE, WS_BASE };