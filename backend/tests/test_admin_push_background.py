"""Order submit must not wait on FCM/web-push."""
from types import SimpleNamespace, ModuleType
import inspect
import sys
from pathlib import Path
from unittest.mock import MagicMock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services import admin_push
from app.routers import orders as orders_router
from app.routers import kyc as kyc_router


def test_submit_order_schedules_background_push():
    params = inspect.signature(orders_router.submit_order).parameters
    assert "background_tasks" in params


def test_kyc_submit_schedules_background_push():
    params = list(inspect.signature(kyc_router.submit_my_kyc).parameters)
    assert params[0] == "background_tasks"


def test_retry_routes_schedule_background_push():
    assert "background_tasks" in inspect.signature(orders_router.retry_my_order).parameters
    assert "background_tasks" in inspect.signature(orders_router.retry_my_order_at_new_price).parameters


def test_send_one_passes_timeout(monkeypatch):
    seen = {}

    fake = ModuleType("pywebpush")

    def webpush(**kwargs):
        seen.update(kwargs)
        return True

    class WebPushException(Exception):
        pass

    fake.webpush = webpush
    fake.WebPushException = WebPushException
    monkeypatch.setitem(sys.modules, "pywebpush", fake)

    row = SimpleNamespace(
        endpoint="https://fcm.googleapis.com/test",
        p256dh="p",
        auth="a",
        admin_username="admin",
    )
    assert admin_push._send_one(MagicMock(), row, {"tag": "order-1"}, "priv") is True
    assert seen["timeout"] == admin_push.WEBPUSH_TIMEOUT_SECONDS


def test_notify_new_order_isolated_closes_session(monkeypatch):
    closed = {"n": 0}

    class FakeSession:
        def query(self, *args, **kwargs):
            q = MagicMock()
            q.all.return_value = []
            return q

        def close(self):
            closed["n"] += 1

    monkeypatch.setattr("app.db.SessionLocal", lambda: FakeSession())
    assert admin_push.notify_new_order_isolated({"id": "1", "side": "buy"}) == 0
    assert closed["n"] == 1


def test_notify_new_order_isolated_survives_errors(monkeypatch):
    class BoomSession:
        def query(self, *args, **kwargs):
            raise RuntimeError("db down")

        def close(self):
            pass

    monkeypatch.setattr("app.db.SessionLocal", lambda: BoomSession())
    assert admin_push.notify_new_order_isolated({"id": "1"}) == 0
