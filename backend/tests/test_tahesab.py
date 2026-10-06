"""Unit tests for Tahesab client (mocked httpx — no live Windows API)."""
from datetime import datetime
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services import tahesab


class _FakeResp:
    def __init__(self, status_code=200, payload=None, text=""):
        self.status_code = status_code
        self._payload = payload
        self.text = text or ("" if payload is None else str(payload))

    def json(self):
        if self._payload is None:
            raise ValueError("no json")
        return self._payload


def setup_function():
    tahesab.settings.TAHESAB_ENABLED = True
    tahesab.settings.TAHESAB_MODE = "direct"
    tahesab.settings.TAHESAB_BASE_URL = "https://203.0.113.10:8081"
    tahesab.settings.TAHESAB_TOKEN = "TESTTOKEN"
    tahesab.settings.TAHESAB_DBNAME = "DB"
    tahesab.settings.TAHESAB_VERIFY_SSL = False
    tahesab.settings.TAHESAB_AMOUNT_SCALE = 10
    tahesab.settings.TAHESAB_DEFAULT_GROUP = "اپلیکیشن"
    tahesab.settings.TAHESAB_SABTE_KOL = 1
    tahesab.settings.TAHESAB_IS_ABSHODE = 1
    tahesab.settings.TAHESAB_TIMEOUT = 5


def test_is_configured_requires_enabled_and_token():
    tahesab.settings.TAHESAB_ENABLED = False
    assert tahesab.is_configured() is False
    tahesab.settings.TAHESAB_ENABLED = True
    tahesab.settings.TAHESAB_TOKEN = ""
    assert tahesab.is_configured() is False
    tahesab.settings.TAHESAB_TOKEN = "x"
    assert tahesab.is_configured() is True


def test_direct_target_rejects_loopback():
    tahesab.settings.TAHESAB_BASE_URL = "https://127.0.0.1:8081"
    assert tahesab.is_direct_target_ready() is False
    tahesab.settings.TAHESAB_BASE_URL = "https://203.0.113.10:8081"
    assert tahesab.is_direct_target_ready() is True


def test_db_guard_allows_test_blocks_main():
    tahesab.settings.TAHESAB_DBNAME = "DB"
    tahesab.settings.TAHESAB_ALLOWED_DBNAMES = "db"
    tahesab.settings.TAHESAB_BLOCKED_DBNAMES = "TahesabDB"
    ok, _ = tahesab.assert_target_db_allowed("db")
    assert ok is True
    ok, reason = tahesab.assert_target_db_allowed("TahesabDB")
    assert ok is False
    assert "blocked" in reason.lower() or "BLOCKED" in reason or "blocked" in reason
    ok, reason = tahesab.assert_target_db_allowed("OtherDB")
    assert ok is False


def test_factor_code_length_and_prefix():
    code = tahesab._factor_code_for_order("a1b2c3d4-e5f6-7890-abcd-ef1234567890")
    assert code.startswith("GA")
    assert len(code) >= 20
    assert "-" not in code


@patch("app.services.tahesab.httpx.Client")
def test_call_method_direct_posts_ascii_unicode_escapes(mock_client_cls):
    client = MagicMock()
    mock_client_cls.return_value.__enter__.return_value = client
    client.post.return_value = _FakeResp(200, {"OK": 1043})

    data = tahesab.call_method_direct(
        "DoNewMoshtari",
        ["علی تست", "اپلیکیشن", "09121234567", "", "0012345678", "", "", -1, 1043, 0],
    )
    assert data == {"OK": 1043}
    args, kwargs = client.post.call_args
    assert args[0] == "https://203.0.113.10:8081"
    assert kwargs["headers"]["Authorization"] == "Bearer TESTTOKEN"
    assert "charset=utf-8" in kwargs["headers"]["Content-Type"]
    raw = kwargs["content"]
    assert isinstance(raw, (bytes, bytearray))
    assert raw.isascii()
    assert b"\\u0639" in raw or b"\\u0639" in raw  # ع
    assert b"\\u00d9" not in raw
    assert "علی تست".encode("utf-8") not in raw


def test_persian_for_tahesab_maps_yeh_keheh():
    assert tahesab._persian_for_tahesab("علی") == "علي"
    assert "\u06cc" not in tahesab._persian_for_tahesab("ته‌حساب")
    assert "\u200c" not in tahesab._persian_for_tahesab("ته‌حساب")


@patch("app.services.tahesab.enqueue_method", return_value="job-1")
def test_create_moshtari_always_queues(mock_enqueue):
    db = MagicMock()
    code = tahesab.create_moshtari(
        name="رضا",
        tel="0912",
        code_meli="1",
        moshtari_code=2001,
        db=db,
        ref_id="u1",
    )
    assert code == 2001
    mock_enqueue.assert_called_once()
    assert mock_enqueue.call_args[0][1] == "DoNewMoshtari"


@patch("app.services.tahesab.call_method_direct")
def test_process_outbox_links_duplicate_phone(mock_direct):
    mock_direct.side_effect = [
        {"ERROR": "تلفن تکراری می باشد."},
        {"1": {"Code": 88, "Name": "x", "Tel": "09120001122"}},
    ]
    db = MagicMock()
    job = SimpleNamespace(
        id="j1",
        method="DoNewMoshtari",
        params_json='["n","g","09120001122","","1","","",-1,1025,0]',
        ref_type="user",
        ref_id="u1",
        attempts=0,
        status="pending",
        last_error=None,
        result_json=None,
    )
    with patch("app.services.tahesab.apply_bridge_result") as apply:
        status = tahesab.process_outbox_job(db, job)
    assert status == "done"
    assert job.status == "done"
    apply.assert_called_once()
    assert apply.call_args[0][2]["OK"] == 88


@patch("app.services.tahesab.call_method_direct", return_value=None)
def test_process_outbox_keeps_pending_when_offline(_mock):
    db = MagicMock()
    job = SimpleNamespace(
        id="j1",
        method="DoNewMoshtari",
        params_json="[]",
        ref_type="user",
        ref_id="u1",
        attempts=0,
        status="pending",
        last_error=None,
        result_json=None,
    )
    status = tahesab.process_outbox_job(db, job)
    assert status == "pending"
    assert job.status == "pending"
    assert "unreachable" in (job.last_error or "")


@patch("app.services.tahesab.create_sanad_buy_sale_gold")
@patch("app.services.tahesab.sync_user_to_tahesab")
def test_sync_accepted_order_gold(mock_sync_user, mock_sanad):
    mock_sync_user.return_value = 1043
    mock_sanad.return_value = "GAOKFACTORCODE00000001"

    user = SimpleNamespace(
        id="u1",
        user_code="1043",
        tahesab_moshtari_id=1043,
        full_name="رضا",
        phone_number="0912",
        national_id="1",
        referrer=None,
    )
    order = SimpleNamespace(
        id="aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
        user_id="u1",
        side=SimpleNamespace(value="buy"),
        amount_type=SimpleNamespace(value="weight"),
        value=2.0,
        description="",
        updated_at=datetime(2025, 10, 5, 12, 0, 0),
        created_at=datetime(2025, 10, 5, 12, 0, 0),
        mesghal17_price_at_submit=30_000_000,
        price_at_submit=6_800_000,
        tahesab_factor_code=None,
    )

    db = MagicMock()
    db.query.return_value.filter.return_value.first.return_value = user

    code = tahesab.sync_accepted_order_to_tahesab(db, order)

    assert code == "GAOKFACTORCODE00000001"
    # Factor is persisted only after outbox ack — not optimistically.
    assert order.tahesab_factor_code is None
    kwargs = mock_sanad.call_args.kwargs
    assert kwargs["buy_or_sale"] == 0
    assert kwargs["vazn"] == 2.0
    assert kwargs["moshtari_code"] == 1043
    assert kwargs["mablagh_kol"] == 2.0 * 6_800_000 * 10  # toman * scale


@patch("app.services.tahesab.create_sanad_buy_sale_gold")
@patch("app.services.tahesab.sync_user_to_tahesab")
def test_sync_accepted_order_defers_until_moshtari(mock_sync_user, mock_sanad):
    mock_sync_user.return_value = None
    user = SimpleNamespace(
        id="u1",
        user_code="1024",
        tahesab_moshtari_id=None,
        full_name="ساسان",
        phone_number="09120419503",
        national_id="1",
        referrer=None,
    )
    order = SimpleNamespace(
        id="bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee",
        user_id="u1",
        side=SimpleNamespace(value="buy"),
        amount_type=SimpleNamespace(value="weight"),
        value=1.0,
        description="",
        updated_at=datetime(2025, 10, 5, 12, 0, 0),
        created_at=datetime(2025, 10, 5, 12, 0, 0),
        mesghal17_price_at_submit=30_000_000,
        price_at_submit=6_800_000,
        tahesab_factor_code=None,
    )
    db = MagicMock()
    db.query.return_value.filter.return_value.first.return_value = user

    assert tahesab.sync_accepted_order_to_tahesab(db, order) is None
    mock_sync_user.assert_called_once()
    mock_sanad.assert_not_called()


@patch("app.services.tahesab.sync_accepted_order_to_tahesab")
def test_apply_bridge_result_queues_pending_sanads(mock_sync_order):
    tahesab.settings.TAHESAB_MODE = "bridge"
    user = SimpleNamespace(id="u1", tahesab_moshtari_id=None)
    db = MagicMock()
    db.query.return_value.filter.return_value.first.return_value = user

    # After OK, apply sets moshtari then flushes pending orders.
    with patch("app.services.tahesab._queue_pending_order_sanads") as flush:
        job = SimpleNamespace(ref_type="user", ref_id="u1")
        tahesab.apply_bridge_result(db, job, {"OK": 1024})
    assert user.tahesab_moshtari_id == 1024
    flush.assert_called_once()


def test_disabled_skips_network():
    tahesab.settings.TAHESAB_ENABLED = False
    with patch("app.services.tahesab.httpx.Client") as mock_client_cls:
        assert tahesab.create_moshtari(name="a", tel="1", code_meli="2", db=MagicMock()) is None
        mock_client_cls.assert_not_called()


@patch("app.services.tahesab.sync_accepted_order_to_tahesab")
def test_catchup_syncs_unsynced_accepted(mock_sync):
    tahesab.settings.TAHESAB_ENABLED = True
    tahesab.settings.TAHESAB_TOKEN = "x"
    order = SimpleNamespace(id="o1")
    db = MagicMock()
    db.query.return_value.filter.return_value.order_by.return_value.limit.return_value.all.return_value = [order]
    n = tahesab.sync_unsynced_accepted_orders(db)
    assert n == 1
    mock_sync.assert_called_once()
