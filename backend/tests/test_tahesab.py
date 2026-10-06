"""Unit tests for Tahesab client (mocked httpx — no live Windows API)."""
from datetime import datetime, timedelta
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


def test_enqueue_flushes_without_commit():
    db = MagicMock()
    db.query.return_value.filter.return_value.first.return_value = None
    oid = tahesab.enqueue_method(db, "DoNewMoshtari", ["a"], ref_type="user", ref_id="u1")
    assert oid
    db.add.assert_called_once()
    db.flush.assert_called_once()
    db.commit.assert_not_called()


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


@patch("app.services.tahesab.call_method_direct")
def test_process_outbox_duplicate_factor_is_success(mock_direct):
    mock_direct.return_value = {"ERROR": "کد فاکتور ارسالی شما (Factor_Code) تکراری می باشد."}
    params = [1, 1002, -1, 1, 1405, 7, 14, 15.0, 750.0, 0, "", 1, 1.0, 0, 1, 1.0, "sharh", "GAFACTOR15"]
    db = MagicMock()
    job = SimpleNamespace(
        id="j1",
        method="DoNewSanadBuySaleGOLD",
        params_json=__import__("json").dumps(params),
        ref_type="order",
        ref_id="o1",
        attempts=0,
        status="pending",
        last_error=None,
        result_json=None,
    )
    with patch("app.services.tahesab.apply_bridge_result") as apply:
        status = tahesab.process_outbox_job(db, job)
    assert status == "done"
    apply.assert_called_once()
    assert apply.call_args[0][2]["OK"] == "GAFACTOR15"


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
        goldbridge_item_id=1,
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
    assert kwargs["buy_or_sale"] == 1
    assert kwargs["vazn"] == 2.0
    assert kwargs["ayar"] == 750
    assert kwargs["is_abshode"] == 1
    assert kwargs["mazaneh_is_gram"] == 0
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


def test_apply_bridge_result_clears_order_sync_flag():
    order = SimpleNamespace(id="o1", tahesab_factor_code=None, tahesab_sync_needed=True)
    db = MagicMock()
    db.query.return_value.filter.return_value.first.return_value = order
    job = SimpleNamespace(ref_type="order", ref_id="o1")
    tahesab.apply_bridge_result(db, job, {"OK": "GAFACTOR"})
    assert order.tahesab_factor_code == "GAFACTOR"
    assert order.tahesab_sync_needed is False


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
    db.commit.assert_called_once()


@patch("app.services.tahesab.create_sanad_buy_sale_gold")
@patch("app.services.tahesab.sync_user_to_tahesab")
def test_sync_motaferaghe_sell_is_shop_buy_ayar_740(mock_sync_user, mock_sanad):
    from app.services.price_cards import SPECIAL_CARD_MOTAFEREGHE_ID

    mock_sync_user.return_value = 1043
    mock_sanad.return_value = "GAMOTAFERAGHEFACTOR0001"

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
        id="cccccccc-bbbb-cccc-dddd-eeeeeeeeeeee",
        user_id="u1",
        side=SimpleNamespace(value="sell"),
        amount_type=SimpleNamespace(value="weight"),
        value=2.0,
        description="",
        updated_at=datetime(2025, 10, 5, 12, 0, 0),
        created_at=datetime(2025, 10, 5, 12, 0, 0),
        mesghal17_price_at_submit=43_900_000,
        price_at_submit=10_000_000,  # already مثقال / 4.39
        goldbridge_item_id=SPECIAL_CARD_MOTAFEREGHE_ID,
        tahesab_factor_code=None,
    )
    db = MagicMock()
    db.query.return_value.filter.return_value.first.return_value = user

    code = tahesab.sync_accepted_order_to_tahesab(db, order)
    assert code == "GAMOTAFERAGHEFACTOR0001"
    kwargs = mock_sanad.call_args.kwargs
    assert kwargs["buy_or_sale"] == 0  # shop buys scrap from the customer
    assert kwargs["ayar"] == 740
    assert kwargs["is_abshode"] == 0  # خرید متفرقه
    assert kwargs["zaman_tasvie"] == ""  # بدون تسویه
    assert kwargs["mazaneh_is_gram"] == 0  # مظنه مثقال۱۷, not گرم
    assert kwargs["vazn"] == 2.0  # physical grams unchanged
    assert kwargs["mablagh_kol"] == 2.0 * 10_000_000 * 10  # وزن × قیمت گرم × scale
    assert kwargs["mazaneh"] == 43_900_000 * 10  # مثقال۱۷ = گرم × 4.39
    assert kwargs["sharh"] == "اپ"


@patch("app.services.tahesab.create_sanad_buy_sale_gold")
@patch("app.services.tahesab.sync_user_to_tahesab")
def test_sync_motaferaghe_mazaneh_from_gram_when_mesghal_missing(mock_sync_user, mock_sanad):
    from app.services.price_cards import SPECIAL_CARD_MOTAFEREGHE_ID

    mock_sync_user.return_value = 1043
    mock_sanad.return_value = "GAMOTAFERAGHEFACTOR0002"
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
        id="dddddddd-bbbb-cccc-dddd-eeeeeeeeeeee",
        user_id="u1",
        side=SimpleNamespace(value="sell"),
        amount_type=SimpleNamespace(value="weight"),
        value=24.33,
        description="",
        updated_at=datetime(2025, 10, 5, 12, 0, 0),
        created_at=datetime(2025, 10, 5, 12, 0, 0),
        mesghal17_price_at_submit=None,
        price_at_submit=263_644_647,  # گرم; مظنه should be ×4.39
        goldbridge_item_id=SPECIAL_CARD_MOTAFEREGHE_ID,
        tahesab_factor_code=None,
    )
    db = MagicMock()
    db.query.return_value.filter.return_value.first.return_value = user
    tahesab.sync_accepted_order_to_tahesab(db, order)
    kwargs = mock_sanad.call_args.kwargs
    assert kwargs["vazn"] == 24.33
    assert kwargs["mazaneh_is_gram"] == 0
    assert kwargs["mazaneh"] == 263_644_647 * 4.39 * 10
    assert kwargs["mablagh_kol"] == 24.33 * 263_644_647 * 10


def test_motaferaghe_weight_converts_740_to_750_then_mesghal17():
    from app.gold_conversion import (
        MOTAFEREGHE_TO_GRAM18,
        gram18_to_motaferaghe_mesghal17,
        motaferaghe_to_gram18,
        motaferaghe_vazn_mesghal17,
        motaferaghe_weight_to_ayar750,
    )

    assert abs(motaferaghe_to_gram18(4.39) - 1.0) < 1e-9
    assert abs(gram18_to_motaferaghe_mesghal17(4.39) - 1.0) < 1e-9
    assert abs(motaferaghe_weight_to_ayar750(750.0) - 740.0) < 1e-9
    expected = (10.0 * 740.0 / 750.0) / MOTAFEREGHE_TO_GRAM18
    assert abs(motaferaghe_vazn_mesghal17(10.0) - expected) < 1e-9


def test_mesghal17_weight_to_gram18():
    from app.gold_conversion import MESGHAL17_TO_GRAM18, mesghal17_weight_to_gram18

    assert abs(mesghal17_weight_to_gram18(1.0) - MESGHAL17_TO_GRAM18) < 1e-9
    assert abs(mesghal17_weight_to_gram18(2.0) - 2.0 * MESGHAL17_TO_GRAM18) < 1e-9


def test_parse_mande_rows_from_docs_shape():
    rows = tahesab.parse_mande_rows(
        {
            "MandeHesab": [
                {"Code": "1043", "MandeyeVazni": 2.5, "MandeyeMali": 1_500_000},
                {"Code": 88, "MandeyeVazni": "-1.0", "MandeyeMali": "-20000"},
            ]
        }
    )
    assert rows == [
        {"code": 1043, "vazni": 2.5, "mali": 1_500_000.0},
        {"code": 88, "vazni": -1.0, "mali": -20_000.0},
    ]


def test_parse_mande_prefers_details_mande_tala():
    rows = tahesab.parse_mande_rows(
        {
            "MandeHesab": [
                {
                    "Code": "1002",
                    "MandeyeMali": "4194765513",
                    "MandeyeVazni": "-1.444",
                    "details": [
                        {"Name": "مانده مالی", "Value": "4194765513"},
                        {"Name": "مانده طلا", "Value": "-1.444", "Value1": "-1.444"},
                    ],
                }
            ]
        }
    )
    assert rows[0]["code"] == 1002
    assert rows[0]["vazni"] == -1.444
    assert rows[0]["mali"] == 4194765513.0


def test_apply_mande_rows_keeps_tahesab_grams_and_unscales_cash():
    user = SimpleNamespace(
        id="u1",
        user_code="1043",
        tahesab_moshtari_id=1043,
        tahesab_gold_balance=None,
        tahesab_cash_balance=None,
        tahesab_balance_at=None,
    )
    db = MagicMock()
    db.query.return_value.filter.return_value.first.return_value = user
    n = tahesab.apply_mande_rows(
        db, [{"code": 1043, "vazni": -1.444, "mali": 4_194_765_513}]
    )
    assert n == 1
    assert user.tahesab_gold_balance == -1.444
    assert user.tahesab_gold_balance != -1.444 * 4.3318
    assert user.tahesab_cash_balance == 419_476_551.3
    assert user.tahesab_balance_at is not None


def test_parse_mande_rows_persian_digits():
    rows = tahesab.parse_mande_rows(
        {"mandehesab": [{"Code": "۱۰۴۳", "MandeyeVazni": "1.5", "MandeyeMali": "0"}]}
    )
    # Arabic decimal ٫ may not parse; at least Code maps.
    assert rows[0]["code"] == 1043


@patch("app.services.tahesab.enqueue_mande_for_user")
@patch("app.services.tahesab.request_asnad_refresh", return_value=True)
def test_apply_bridge_result_order_queues_mande(mock_asnad, mock_mande):
    user = SimpleNamespace(id="u1", tahesab_moshtari_id=1043)
    order = SimpleNamespace(
        id="o1",
        user_id="u1",
        tahesab_factor_code=None,
        tahesab_sync_needed=True,
    )
    db = MagicMock()
    db.query.return_value.filter.return_value.first.side_effect = [order, user]
    job = SimpleNamespace(method="DoNewSanadBuySaleGOLD", ref_type="order", ref_id="o1")
    tahesab.apply_bridge_result(db, job, {"OK": "GAFACTOR"})
    assert order.tahesab_factor_code == "GAFACTOR"
    mock_mande.assert_called_once()
    assert mock_mande.call_args.kwargs["ref_suffix"] == "o1"
    mock_asnad.assert_called_once()


def test_apply_bridge_result_mande_updates_user():
    user = SimpleNamespace(
        id="u1",
        user_code="1043",
        tahesab_moshtari_id=1043,
        tahesab_gold_balance=None,
        tahesab_cash_balance=None,
        tahesab_balance_at=None,
    )
    db = MagicMock()
    db.query.return_value.filter.return_value.first.return_value = user
    job = SimpleNamespace(method="getmandehesabbycode", ref_type="mande-day", ref_id="2026-10-06:0")
    tahesab.apply_bridge_result(
        db,
        job,
        {"MandeHesab": [{"Code": 1043, "MandeyeVazni": 1, "MandeyeMali": 10000}]},
    )
    assert user.tahesab_gold_balance == 1.0
    assert user.tahesab_cash_balance == 1000.0


@patch("app.services.tahesab.call_method_direct")
def test_process_outbox_mande_without_ok_is_success(mock_direct):
    mock_direct.return_value = {
        "MandeHesab": [{"Code": 1, "MandeyeVazni": 0, "MandeyeMali": 0}]
    }
    db = MagicMock()
    job = SimpleNamespace(
        id="j1",
        method="getmandehesabbycode",
        params_json='["1"]',
        ref_type="mande",
        ref_id="u1",
        attempts=0,
        status="pending",
        last_error=None,
        result_json=None,
    )
    with patch("app.services.tahesab.apply_bridge_result") as apply:
        status = tahesab.process_outbox_job(db, job)
    assert status == "done"
    apply.assert_called_once()


@patch("app.services.tahesab.enqueue_mande_for_all_users", return_value=3)
def test_maybe_enqueue_on_first_online(mock_enq):
    db = MagicMock()
    with patch("app.services.tahesab._get_app_setting", return_value=None), patch(
        "app.services.tahesab._set_app_setting"
    ) as set_s:
        n = tahesab.maybe_enqueue_online_mande_refresh(db)
    assert n == 3
    mock_enq.assert_called_once()
    keys = [c.args[1] for c in set_s.call_args_list]
    assert tahesab.SETTING_MANDE_REFRESH_DAY in keys
    assert tahesab.SETTING_AGENT_LAST_SEEN in keys


@patch("app.services.tahesab.enqueue_mande_for_all_users", return_value=1)
def test_maybe_enqueue_after_agent_gap(mock_enq):
    now = datetime.utcnow()
    last = (now - timedelta(minutes=31)).isoformat()
    today = tahesab._tehran_today_iso()

    def get_s(_db, key):
        if key == tahesab.SETTING_AGENT_LAST_SEEN:
            return last
        if key == tahesab.SETTING_MANDE_HOLD_DAY:
            return None
        return today

    db = MagicMock()
    with patch("app.services.tahesab._get_app_setting", side_effect=get_s), patch(
        "app.services.tahesab._set_app_setting"
    ):
        n = tahesab.maybe_enqueue_online_mande_refresh(db)
    assert n == 1
    mock_enq.assert_called_once()


@patch("app.services.tahesab.enqueue_mande_for_all_users", return_value=1)
def test_maybe_enqueue_skips_same_day_recent_poll(mock_enq):
    now = datetime.utcnow()
    last = (now - timedelta(seconds=10)).isoformat()
    today = tahesab._tehran_today_iso()

    def get_s(_db, key):
        if key == tahesab.SETTING_AGENT_LAST_SEEN:
            return last
        if key == tahesab.SETTING_MANDE_HOLD_DAY:
            return None
        return today

    db = MagicMock()
    with patch("app.services.tahesab._get_app_setting", side_effect=get_s), patch(
        "app.services.tahesab._set_app_setting"
    ):
        n = tahesab.maybe_enqueue_online_mande_refresh(db)
    assert n == 0
    mock_enq.assert_not_called()


@patch("app.services.tahesab.enqueue_mande_for_all_users", return_value=2)
def test_maybe_enqueue_on_new_tehran_day(mock_enq):
    now = datetime.utcnow()
    last = (now - timedelta(seconds=5)).isoformat()

    def get_s(_db, key):
        if key == tahesab.SETTING_AGENT_LAST_SEEN:
            return last
        return "2020-01-01"

    db = MagicMock()
    with patch("app.services.tahesab._get_app_setting", side_effect=get_s), patch(
        "app.services.tahesab._set_app_setting"
    ):
        n = tahesab.maybe_enqueue_online_mande_refresh(db)
    assert n == 2
    mock_enq.assert_called_once()


@patch("app.services.tahesab.enqueue_method", return_value="job-mande")
def test_enqueue_mande_for_user_uses_code(mock_enqueue):
    db = MagicMock()
    user = SimpleNamespace(id="u1", tahesab_moshtari_id=1043)
    oid = tahesab.enqueue_mande_for_user(db, user, ref_suffix="order-1")
    assert oid == "job-mande"
    mock_enqueue.assert_called_once()
    args, kwargs = mock_enqueue.call_args
    assert args[1] == "getmandehesabbycode"
    assert args[2] == ["1043"]
    assert kwargs["ref_type"] == "mande"
    assert kwargs["ref_id"] == "u1:order-1"


@patch("app.services.tahesab.enqueue_mande_for_user", return_value="job-mande")
def test_request_mande_skips_when_fresh(mock_enq):
    user = SimpleNamespace(
        id="u1",
        tahesab_moshtari_id=1043,
        tahesab_balance_at=datetime.utcnow(),
    )
    assert tahesab.request_mande_refresh(MagicMock(), user, force=False) is None
    mock_enq.assert_not_called()


@patch("app.services.tahesab.enqueue_mande_for_user", return_value="job-mande")
def test_request_mande_force_enqueues_even_if_fresh(mock_enq):
    user = SimpleNamespace(
        id="u1",
        tahesab_moshtari_id=1043,
        tahesab_balance_at=datetime.utcnow(),
    )
    assert tahesab.request_mande_refresh(MagicMock(), user, force=True) == "job-mande"
    mock_enq.assert_called_once()


@patch("app.services.tahesab.enqueue_mande_for_user", return_value="job-mande")
def test_request_mande_enqueues_when_stale(mock_enq):
    user = SimpleNamespace(
        id="u1",
        tahesab_moshtari_id=1043,
        tahesab_balance_at=datetime.utcnow() - timedelta(minutes=6),
    )
    assert tahesab.request_mande_refresh(MagicMock(), user, force=False) == "job-mande"
    mock_enq.assert_called_once()


@patch("app.services.tahesab.create_moshtari")
@patch("app.services.tahesab._queue_pending_order_sanads")
@patch("app.services.tahesab.enqueue_mande_for_user")
@patch("app.services.tahesab.lookup_existing_moshtari", return_value=55)
def test_sync_user_links_existing_without_create(
    mock_lookup, mock_mande, mock_sanads, mock_create
):
    user = SimpleNamespace(
        id="u1",
        user_code="1001",
        tahesab_moshtari_id=None,
        full_name="علی",
        phone_number="09120001122",
        national_id="1",
        referrer=None,
    )
    code = tahesab.sync_user_to_tahesab(MagicMock(), user)
    assert code == 55
    assert user.tahesab_moshtari_id == 55
    mock_create.assert_not_called()
    mock_lookup.assert_called_once()
    mock_sanads.assert_called_once()


@patch("app.services.tahesab.create_moshtari", return_value=None)
@patch("app.services.tahesab.lookup_existing_moshtari")
def test_sync_user_bridge_queues_without_direct_lookup(mock_lookup, mock_create):
    tahesab.settings.TAHESAB_MODE = "bridge"
    user = SimpleNamespace(
        id="u1",
        user_code="1001",
        tahesab_moshtari_id=None,
        full_name="علی",
        phone_number="09120001122",
        national_id="1",
        referrer=None,
    )
    code = tahesab.sync_user_to_tahesab(MagicMock(), user)
    assert code is None
    mock_lookup.assert_not_called()
    mock_create.assert_called_once()


@patch("app.services.tahesab.lookup_existing_moshtari", return_value=None)
@patch("app.services.tahesab.call_method_direct")
def test_process_outbox_links_duplicate_via_preferred_code(mock_direct, mock_lookup):
    mock_direct.return_value = {"ERROR": "کد مشتری تکراری می باشد."}
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
    apply.assert_called_once()
    assert apply.call_args[0][2]["OK"] == 1025
    assert apply.call_args[0][2]["linked"] is True


def test_resolve_duplicate_prefers_phone_then_code():
    with patch("app.services.tahesab.lookup_existing_moshtari", return_value=88) as lookup:
        code = tahesab.resolve_duplicate_moshtari(
            ["n", "g", "0912", "", "1", "", "", -1, 1025, 0]
        )
    assert code == 88
    assert lookup.call_args.kwargs["tel"] == "0912"
    assert lookup.call_args.kwargs["preferred_code"] == 1025


@patch("app.services.tahesab.sync_user_to_tahesab")
def test_catchup_syncs_unsynced_users(mock_sync):
    user = SimpleNamespace(id="u1", user_code="1001")
    db = MagicMock()
    user_q = MagicMock()
    user_q.filter.return_value.order_by.return_value.limit.return_value.all.return_value = [
        user
    ]
    outbox_q = MagicMock()
    outbox_q.filter.return_value.first.return_value = None

    def query_side(model):
        name = getattr(model, "__name__", "")
        if name == "TahesabOutbox":
            return outbox_q
        return user_q

    db.query.side_effect = query_side
    n = tahesab.sync_unsynced_users_to_tahesab(db)
    assert n == 1
    mock_sync.assert_called_once()
    db.commit.assert_called_once()


@patch("app.services.tahesab.sync_user_to_tahesab")
def test_catchup_skips_users_with_pending_moshtari_job(mock_sync):
    user = SimpleNamespace(id="u1", user_code="1001")
    db = MagicMock()
    user_q = MagicMock()
    user_q.filter.return_value.order_by.return_value.limit.return_value.all.return_value = [
        user
    ]
    outbox_q = MagicMock()
    outbox_q.filter.return_value.first.return_value = SimpleNamespace(id="job1")

    def query_side(model):
        name = getattr(model, "__name__", "")
        if name == "TahesabOutbox":
            return outbox_q
        return user_q

    db.query.side_effect = query_side
    n = tahesab.sync_unsynced_users_to_tahesab(db)
    assert n == 0
    mock_sync.assert_not_called()
    db.commit.assert_not_called()


@patch("app.services.tahesab.clear_mande_hold")
@patch("app.services.tahesab.cancel_pending_mande_jobs", return_value=2)
def test_reset_all_app_remainings_zeros_cache_and_ledger(mock_cancel, mock_hold):
    user = SimpleNamespace(
        id="u1",
        user_code="1001",
        tahesab_gold_balance=-1.444,
        tahesab_cash_balance=419_476_551.3,
        tahesab_balance_at=None,
    )
    db = MagicMock()
    calls = {"n": 0}

    def query_side(*_args, **_kwargs):
        calls["n"] += 1
        q = MagicMock()
        if calls["n"] == 1:
            q.all.return_value = [user]
        elif calls["n"] == 2:
            q.filter.return_value.group_by.return_value.all.return_value = [
                ("u1", -1.444, 419_476_551.3)
            ]
        else:
            q.filter.return_value.first.return_value = None
        return q

    db.query.side_effect = query_side
    stats = tahesab.reset_all_app_remainings(db)
    assert stats["users"] == 1
    assert stats["ledger_offsets"] == 1
    assert stats["mande_cancelled"] == 2
    assert user.tahesab_gold_balance == 0.0
    assert user.tahesab_cash_balance == 0.0
    assert user.tahesab_balance_at is not None
    mock_cancel.assert_called_once()
    mock_hold.assert_called_once()
    offset = [
        call[0][0]
        for call in db.add.call_args_list
        if getattr(call[0][0], "gold_change", None) is not None
    ][-1]
    assert offset.gold_change == 1.444
    assert offset.cash_change == -419_476_551.3


def test_parse_asnad_rows_running_balance_and_short_app_sharh():
    payload = {
        "17": {
            "ID": 17,
            "Factor_Code": "ga1",
            "NO": "فروش طلا",
            "ZamanSabt": "1405/07/14 17:26:32",
            "Vazn": 2,
            "Mazaneh": 1156800000,
            "Mali": -534096680,
            "TabdilVazn": 2,
            "TahesabVazni": 2,
            "TahesabMali": -534096680,
            "Sharh1": "اپ خرید طلا کد مشتری 1002 سفارش a183e7af",
            "User": "APi",
        },
        "23": {
            "ID": 23,
            "Factor_Code": "x23",
            "NO": "ورود متفرقه",
            "ZamanSabt": "1405/07/14 17:46:45",
            "Vazn": 24.33,
            "Mazaneh": "null",
            "Mali": "null",
            "TabdilVazn": 24.006,
            "TahesabVazni": 2,
            "TahesabMali": 6380377580,
            "Sharh1": None,
            "User": "مدير",
        },
    }
    rows = tahesab.parse_asnad_rows(payload)
    assert len(rows) == 2
    assert rows[0]["doc_type"] == "فروش طلا"
    assert rows[0]["explanation"] == "اپ"
    assert rows[0]["money"] == -53409668.0  # unscaled /10
    assert rows[1]["doc_type"] == "ورود متفرقه"
    assert rows[1]["weight"] == 24.33
    assert rows[1]["cash_balance"] == 638037758.0


def test_parse_asnad_rows_unwraps_list_envelope():
    payload = [
        {
            "23": {
                "ID": 23,
                "Factor_Code": "x23",
                "NO": "ورود متفرقه",
                "ZamanSabt": "1405/07/14 17:46:45",
                "Vazn": 24.33,
                "TahesabVazni": 2,
                "TahesabMali": 0,
                "User": "مدير",
            }
        }
    ]
    rows = tahesab.parse_asnad_rows(payload)
    assert len(rows) == 1
    assert rows[0]["doc_type"] == "ورود متفرقه"


@patch("app.services.tahesab.is_configured", return_value=True)
@patch("app.services.tahesab.enqueue_method", return_value="job-asnad")
@patch("app.services.tahesab.asnad_job_pending", return_value=False)
@patch("app.services.tahesab.release_stale_asnad_jobs", return_value=0)
def test_request_asnad_soft_skips_fresh_cache(mock_release, mock_pending, mock_enq, mock_cfg):
    user = SimpleNamespace(
        id="u1",
        tahesab_moshtari_id=1002,
        tahesab_asnad_at=datetime.utcnow(),
        tahesab_asnad_json='[{"id":"1","doc_type":"ورود متفرقه"}]',
    )
    assert tahesab.request_asnad_refresh(MagicMock(), user, force=False) is False
    mock_enq.assert_not_called()


@patch("app.services.tahesab.is_configured", return_value=True)
@patch("app.services.tahesab.enqueue_method", return_value="job-asnad")
@patch("app.services.tahesab.asnad_job_pending", return_value=False)
@patch("app.services.tahesab.release_stale_asnad_jobs", return_value=0)
def test_request_asnad_soft_queues_when_empty(mock_release, mock_pending, mock_enq, mock_cfg):
    user = SimpleNamespace(
        id="u1",
        tahesab_moshtari_id=1002,
        tahesab_asnad_at=datetime.utcnow(),
        tahesab_asnad_json="[]",
    )
    assert tahesab.request_asnad_refresh(MagicMock(), user, force=False) is True
    mock_enq.assert_called_once()
    args = mock_enq.call_args
    params = args[0][2]
    assert params[0] == -1
    assert params[1] == 1002
    assert params[2] == "1400-01-01"
    assert params[4] == ""
    assert params[5] == 0


@patch("app.services.tahesab.is_configured", return_value=True)
@patch("app.services.tahesab.enqueue_method", return_value="job-asnad")
@patch("app.services.tahesab.asnad_job_pending", return_value=True)
@patch("app.services.tahesab.release_stale_asnad_jobs", return_value=0)
def test_request_asnad_dedupes_inflight(mock_release, mock_pending, mock_enq, mock_cfg):
    user = SimpleNamespace(
        id="u1",
        tahesab_moshtari_id=1002,
        tahesab_asnad_at=None,
        tahesab_asnad_json=None,
    )
    assert tahesab.request_asnad_refresh(MagicMock(), user, force=True) is True
    mock_enq.assert_not_called()


@patch("app.services.tahesab.is_configured", return_value=True)
@patch("app.services.tahesab.enqueue_method", return_value="job-asnad")
@patch("app.services.tahesab.asnad_job_pending", return_value=False)
@patch("app.services.tahesab.release_stale_asnad_jobs", return_value=0)
def test_request_asnad_force_queues_even_if_fresh(mock_release, mock_pending, mock_enq, mock_cfg):
    user = SimpleNamespace(
        id="u1",
        tahesab_moshtari_id=1002,
        tahesab_asnad_at=datetime.utcnow(),
        tahesab_asnad_json='[{"id":"1","doc_type":"ورود متفرقه"}]',
    )
    assert tahesab.request_asnad_refresh(MagicMock(), user, force=True) is True
    mock_enq.assert_called_once()


@patch("app.services.tahesab.is_configured", return_value=True)
@patch("app.services.tahesab.enqueue_method", return_value="job-asnad")
@patch("app.services.tahesab.asnad_job_pending", return_value=False)
@patch("app.services.tahesab.release_stale_asnad_jobs", return_value=0)
def test_request_asnad_view_stale_shorter_max_age(mock_release, mock_pending, mock_enq, mock_cfg):
    user = SimpleNamespace(
        id="u1",
        tahesab_moshtari_id=1002,
        tahesab_asnad_at=datetime.utcnow() - timedelta(minutes=3),
        tahesab_asnad_json='[{"id":"1","doc_type":"طلب"}]',
    )
    # Default 15m stale → skip
    assert tahesab.request_asnad_refresh(MagicMock(), user, force=False) is False
    # View stale 2m → queue so latest جزئیات اسناد appear
    assert (
        tahesab.request_asnad_refresh(
            MagicMock(), user, force=False, max_age=tahesab.ASNAD_VIEW_STALE_SECONDS
        )
        is True
    )
    mock_enq.assert_called_once()


def test_books_reset_at_parses_iso():
    db = MagicMock()
    db.query.return_value.filter.return_value.first.return_value = SimpleNamespace(
        value="2026-10-06T13:43:43.478599"
    )
    assert tahesab.books_reset_at(db) == datetime(2026, 10, 6, 13, 43, 43, 478599)


def test_filter_since_books_reset_hides_older_rows():
    db = MagicMock()
    db.query.return_value.filter.return_value.first.return_value = SimpleNamespace(
        value="2026-10-06T13:43:43"
    )
    query = MagicMock()
    filtered = MagicMock()
    query.filter.return_value = filtered

    class _Col:
        def __gt__(self, other):
            self.other = other
            return True

    column = _Col()
    assert tahesab.filter_since_books_reset(db, query, column) is filtered
    query.filter.assert_called_once()
    assert column.other == datetime(2026, 10, 6, 13, 43, 43)


def test_filter_since_books_reset_noop_without_cutoff():
    db = MagicMock()
    db.query.return_value.filter.return_value.first.return_value = None
    query = MagicMock()
    assert tahesab.filter_since_books_reset(db, query, object()) is query
    query.filter.assert_not_called()


def test_apply_mande_does_not_create_app_users():
    db = MagicMock()
    db.query.return_value.filter.return_value.first.return_value = None
    n = tahesab.apply_mande_rows(db, [{"code": 9999, "vazni": 3.0, "mali": 1000}])
    assert n == 0
    db.add.assert_not_called()


def test_moshtari_codes_from_numbered_payload():
    codes = tahesab._moshtari_codes_from_payload(
        {"1": {"Code": 88, "Name": "x", "Tel": "0912"}}
    )
    assert codes == [88]

