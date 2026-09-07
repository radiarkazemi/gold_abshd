"""متفرقه / نقد کارتخوان must follow id:1 live OR manual quotes."""
from types import SimpleNamespace
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services import price_cards


def _source(**kwargs):
    defaults = dict(
        goldbridge_item_id=1,
        display_name="نقد یکشنبه",
        use_manual_price=False,
        manual_buy=None,
        manual_sell=None,
        price_source_item_id=None,
    )
    defaults.update(kwargs)
    return SimpleNamespace(**defaults)


def _mota():
    return SimpleNamespace(
        goldbridge_item_id=price_cards.SPECIAL_CARD_MOTAFEREGHE_ID,
        display_name="متفرقه",
        use_manual_price=False,
        manual_buy=None,
        manual_sell=None,
        price_source_item_id=1,
    )


def _naghd():
    return SimpleNamespace(
        goldbridge_item_id=price_cards.SPECIAL_CARD_NAGHD_KARTKHAN_ID,
        display_name="نقد کارتخوان",
        use_manual_price=False,
        manual_buy=None,
        manual_sell=None,
        price_source_item_id=1,
    )


def _live(buy=12_000_000, sell=11_900_000):
    return {
        "goldbridge_item_id": 1,
        "name": "نقد یکشنبه",
        "type": 1,
        "buy": buy,
        "sell": sell,
        "allow_buy": True,
        "allow_sell": True,
        "active": True,
    }


def setup_function():
    price_cards._latest_items.clear()


def test_motaferaghe_follows_live_buy():
    price_cards._latest_items[1] = _live(12_000_000, 11_900_000)
    out = price_cards.resolve_effective_item(_mota(), None, source_card=_source())
    assert out["buy"] == 12_000_000
    assert out["sell"] == 12_000_000  # formula uses id:1 buy
    assert out["pricing_mode"] == "motaferaghe_sell"
    assert out["price_source"] == "mirrored"
    assert out["mirrored_source_mode"] == "live"


def test_specials_follow_id1_manual_even_when_live_exists():
    # Stale/wrong live must lose to id:1 manual, same as the source card itself.
    price_cards._latest_items[1] = _live(1, 1)
    src = _source(use_manual_price=True, manual_buy=10_500_000, manual_sell=10_400_000)

    mota = price_cards.resolve_effective_item(_mota(), None, source_card=src)
    assert mota["buy"] == 10_500_000
    assert mota["sell"] == 10_500_000
    assert mota["pricing_mode"] == "motaferaghe_sell"
    assert mota["mirrored_source_mode"] == "manual"

    naghd = price_cards.resolve_effective_item(_naghd(), None, source_card=src)
    assert naghd["buy"] == 10_500_000
    assert naghd["sell"] == 10_500_000
    assert naghd["pricing_mode"] == "naghd_kartkhan_buy"
    assert naghd["markup_toman"] == 100_000
    assert naghd["mirrored_source_mode"] == "manual"


def test_specials_follow_id1_manual_when_feed_is_down():
    price_cards._latest_items.clear()
    src = _source(use_manual_price=True, manual_buy=9_000_000, manual_sell=8_900_000)
    mota = price_cards.resolve_effective_item(_mota(), None, source_card=src)
    naghd = price_cards.resolve_effective_item(_naghd(), None, source_card=src)
    assert mota["buy"] == 9_000_000
    assert naghd["buy"] == 9_000_000
    assert mota["mirrored_source_mode"] == "manual"


def test_unavailable_when_feed_down_and_id1_not_manual():
    price_cards._latest_items.clear()
    assert price_cards.resolve_effective_item(_mota(), None, source_card=_source()) is None


if __name__ == "__main__":
    setup_function()
    test_motaferaghe_follows_live_buy()
    setup_function()
    test_specials_follow_id1_manual_even_when_live_exists()
    setup_function()
    test_specials_follow_id1_manual_when_feed_is_down()
    setup_function()
    test_unavailable_when_feed_down_and_id1_not_manual()
    print("ok")
