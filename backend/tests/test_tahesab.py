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
    tahesab.settings.TAHESAB_BASE_URL = "https://127.0.0.1:8081"
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


def test_factor_code_length_and_prefix():
    code = tahesab._factor_code_for_order("a1b2c3d4-e5f6-7890-abcd-ef1234567890")
    assert code.startswith("GA")
    assert len(code) >= 20
    assert "-" not in code


@patch("app.services.tahesab.httpx.Client")
def test_create_moshtari_posts_expected_body(mock_client_cls):
    client = MagicMock()
    mock_client_cls.return_value.__enter__.return_value = client
    client.post.return_value = _FakeResp(200, {"OK": 1043})

    code = tahesab.create_moshtari(
        name="علی تست",
        tel="09121234567",
        code_meli="0012345678",
        moshtari_code=1043,
    )
    assert code == 1043
    args, kwargs = client.post.call_args
    assert args[0] == "https://127.0.0.1:8081"
    assert kwargs["headers"]["Authorization"] == "Bearer TESTTOKEN"
    assert kwargs["headers"]["DBName"] == "DB"
    body = kwargs["json"]
    assert "DoNewMoshtari" in body
    params = body["DoNewMoshtari"]
    assert params[0] == "علی تست"
    assert params[2] == "09121234567"
    assert params[4] == "0012345678"
    assert params[8] == 1043


@patch("app.services.tahesab.httpx.Client")
def test_create_sanad_gold_shop_sell_when_customer_buys(mock_client_cls):
    client = MagicMock()
    mock_client_cls.return_value.__enter__.return_value = client
    client.post.return_value = _FakeResp(200, {"OK": "GAFACTORCODE1234567890", "Sh_factor": "1"})

    ok = tahesab.create_sanad_buy_sale_gold(
        moshtari_code=1043,
        shamsi_year=1404,
        shamsi_month=7,
        shamsi_day=13,
        vazn=2.5,
        ayar=750,
        buy_or_sale=0,  # فروش از دید مغازه
        mazaneh=350_000_000,
        mazaneh_is_gram=0,
        is_abshode=1,
        mablagh_kol=20_000_000,
        sharh="test",
        factor_code="GA" + "0" * 30,
    )
    assert ok.startswith("GA")
    body = client.post.call_args.kwargs["json"]
    params = body["DoNewSanadBuySaleGOLD"]
    assert params[1] == 1043
    assert params[7] == 2.5
    assert params[8] == 750
    assert params[11] == 0  # فروش
    assert params[14] == 1  # آبشده


@patch("app.services.tahesab.create_moshtari")
def test_sync_user_stores_moshtari_id(mock_create):
    mock_create.return_value = 2044
    db = MagicMock()
    user = SimpleNamespace(
        id="u1",
        user_code="2044",
        full_name="رضا",
        phone_number="09120000000",
        national_id="123",
        referrer=None,
        tahesab_moshtari_id=None,
    )
    code = tahesab.sync_user_to_tahesab(db, user)
    assert code == 2044
    assert user.tahesab_moshtari_id == 2044
    db.commit.assert_called()


@patch("app.services.tahesab.create_sanad_buy_sale_gold")
@patch("app.services.tahesab.sync_user_to_tahesab")
def test_sync_accepted_order_gold(mock_sync_user, mock_sanad):
    mock_sync_user.return_value = 1043
    mock_sanad.return_value = "GAOKFACTORCODE00000001"

    user = SimpleNamespace(
        id="u1",
        user_code="1043",
        tahesab_moshtari_id=None,
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
    assert order.tahesab_factor_code == code
    kwargs = mock_sanad.call_args.kwargs
    assert kwargs["buy_or_sale"] == 0  # customer buy → shop sell
    assert kwargs["vazn"] == 2.0
    assert kwargs["ayar"] == 750
    assert kwargs["mazaneh"] == 300_000_000  # ×10 Rial scale
    assert kwargs["mablagh_kol"] == 136_000_000


@patch("app.services.tahesab.httpx.Client")
def test_call_method_soft_fails_on_http_error(mock_client_cls):
    client = MagicMock()
    mock_client_cls.return_value.__enter__.return_value = client
    client.post.return_value = _FakeResp(500, text="boom")
    assert tahesab.call_method("CheckHealth", []) is None


def test_disabled_skips_network():
    tahesab.settings.TAHESAB_ENABLED = False
    with patch("app.services.tahesab.httpx.Client") as mock_client_cls:
        assert tahesab.create_moshtari(name="a", tel="1", code_meli="2") is None
        mock_client_cls.assert_not_called()
