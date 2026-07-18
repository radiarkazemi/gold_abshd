"""
مدیریت اتصالات WebSocket - برای پخش زنده قیمت به همه کلاینت‌ها
و اطلاع‌رسانی به کلاینت مربوطه وقتی سفارشش accept/reject شد.
"""
from fastapi import WebSocket
from typing import Dict, List
import json

from app.obfuscation import encode_payload


class ConnectionManager:
    def __init__(self):
        self.price_connections: List[WebSocket] = []
        self.admin_connections: List[WebSocket] = []

    # --- اتصال کلاینت‌های عادی (برای دریافت قیمت زنده) ---
    async def connect_price(self, ws: WebSocket):
        await ws.accept()
        self.price_connections.append(ws)

    def disconnect_price(self, ws: WebSocket):
        if ws in self.price_connections:
            self.price_connections.remove(ws)

    async def broadcast_price(self, price_data: dict):
        """
        price_data is obfuscated before it goes over the wire - see
        app/obfuscation.py for the scheme and what it does/doesn't
        protect against. Frontend decodes with the matching helper in
        src/utils/payloadCodec.js.
        """
        payload = json.dumps({"payload": encode_payload(price_data)})
        dead = []
        for conn in self.price_connections:
            try:
                await conn.send_text(payload)
            except Exception:
                dead.append(conn)
        for d in dead:
            self.disconnect_price(d)

    # --- اتصال ادمین (برای دریافت سفارش‌های جدید به صورت زنده) ---
    async def connect_admin(self, ws: WebSocket):
        await ws.accept()
        self.admin_connections.append(ws)

    def disconnect_admin(self, ws: WebSocket):
        if ws in self.admin_connections:
            self.admin_connections.remove(ws)

    async def broadcast_to_admins(self, data: dict):
        dead = []
        for conn in self.admin_connections:
            try:
                await conn.send_text(json.dumps(data, default=str))
            except Exception:
                dead.append(conn)
        for d in dead:
            self.disconnect_admin(d)


manager = ConnectionManager()