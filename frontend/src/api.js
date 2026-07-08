const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:8000";
const WS_BASE = API_BASE.replace(/^http/, "ws");
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

function authHeaders() {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function requestOtp(phoneNumber) {
  const res = await fetch(`${API_BASE}/api/auth/request-otp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone_number: phoneNumber }),
  });
  if (!res.ok) throw new Error("Failed to request OTP");
  return res.json();
}

export async function verifyOtp(phoneNumber, code) {
  const res = await fetch(`${API_BASE}/api/auth/verify-otp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone_number: phoneNumber, code }),
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
  if (!res.ok) throw new Error("Failed to submit order");
  return res.json();
}

export async function fetchOrder(orderId) {
  const res = await fetch(`${API_BASE}/api/orders/${orderId}`);
  if (!res.ok) throw new Error("Failed to fetch order");
  return res.json();
}

export async function fetchOrders(status) {
  const url = new URL(`${API_BASE}/api/admin/orders`);
  if (status) url.searchParams.set("status", status);
  const res = await fetch(url);
  if (!res.ok) throw new Error("Failed to fetch orders");
  return res.json();
}

export async function decideOrder(orderId, status) {
  const res = await fetch(`${API_BASE}/api/admin/orders/${orderId}/decide`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status }),
  });
  if (!res.ok) throw new Error("Failed to update order");
  return res.json();
}

export function openAdminSocket(onMessage) {
  const ws = new WebSocket(`${WS_BASE}/ws/admin`);
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