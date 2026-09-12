"""متفرقه / نقد کارتخوان must follow id:1 live OR manual quotes."""
from types import SimpleNamespace
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import settings
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
    price_cards._manual_quotes.clear()
    price_cards._item_price_changed_at.clear()
    price_cards._latest_updated_at = None
    price_cards._card_config_cache = None
    price_cards._specials_ready = False
    settings.EXTRA_SHOP_MARGIN_TOMAN = 0
    settings.PRICE_API_RIAL_TO_TOMAN = True


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


def test_uses_entered_manual_buy_not_sell_even_if_sell_missing():
    """Base is the typed خرید field, never فروش, and sell is not required."""
    price_cards._latest_items[1] = _live(99_999_999, 88_888_888)
    src = _source(use_manual_price=True, manual_buy=34_500_000, manual_sell=None)
    mota = price_cards.resolve_effective_item(_mota(), None, source_card=src)
    naghd = price_cards.resolve_effective_item(_naghd(), None, source_card=src)
    assert mota["buy"] == 34_500_000
    assert mota["sell"] == 34_500_000
    assert naghd["buy"] == 34_500_000
    assert mota["mirrored_source_mode"] == "manual"


def test_unavailable_when_feed_down_and_id1_not_manual():
    price_cards._latest_items.clear()
    assert price_cards.resolve_effective_item(_mota(), None, source_card=_source()) is None


def test_manual_cache_wins_over_stale_source_card():
    """A just-saved id:1 buy must move the specials before Postgres is re-read."""
    price_cards._latest_items[1] = _live(1, 1)
    price_cards._manual_quotes[1] = {
        "use_manual": True,
        "buy": 7_000_000,
        "sell": 6_900_000,
    }
    stale = _source(use_manual_price=True, manual_buy=1, manual_sell=1)
    mota = price_cards.resolve_effective_item(_mota(), None, source_card=stale)
    naghd = price_cards.resolve_effective_item(_naghd(), None, source_card=stale)
    assert mota["buy"] == 7_000_000
    assert naghd["buy"] == 7_000_000
    assert mota["mirrored_source_mode"] == "manual"


def test_manual_cache_works_without_source_card_or_db():
    price_cards._latest_items.clear()
    price_cards._manual_quotes[1] = {
        "use_manual": True,
        "buy": 8_250_000,
        "sell": 8_200_000,
    }
    mota = price_cards.resolve_effective_item(_mota(), None, source_card=None)
    assert mota["buy"] == 8_250_000
    assert mota["mirrored_source_mode"] == "manual"


def test_ensure_specials_is_noop_once_ready():
    price_cards._specials_ready = True
    # Must not open a DB session / commit.
    price_cards.ensure_special_mirrored_cards(db=None)


def test_broadcast_hot_path_uses_manual_cache_without_db():
    from types import SimpleNamespace

    def snap(item_id, **kwargs):
        defaults = dict(
            display_name=str(item_id),
            use_manual_price=False,
            manual_buy=None,
            manual_sell=None,
            price_source_item_id=None,
            price_label_mode=None,
            is_enabled=True,
            orderable_buy=True,
            orderable_sell=True,
            override_source_restriction=True,
            sort_order=item_id,
            created_at=None,
        )
        defaults.update(kwargs)
        return SimpleNamespace(goldbridge_item_id=item_id, **defaults)

    price_cards._manual_quotes[1] = {
        "use_manual": True,
        "buy": 5_000_000,
        "sell": 4_900_000,
    }
    price_cards._card_config_cache = [
        snap(1, display_name="نقد یکشنبه", use_manual_price=True, manual_buy=1, manual_sell=1),
        snap(
            price_cards.SPECIAL_CARD_MOTAFEREGHE_ID,
            display_name="متفرقه",
            price_source_item_id=1,
            orderable_buy=False,
            orderable_sell=True,
        ),
        snap(
            price_cards.SPECIAL_CARD_NAGHD_KARTKHAN_ID,
            display_name="نقد کارتخوان",
            price_source_item_id=1,
            orderable_buy=True,
            orderable_sell=False,
        ),
    ]
    cards = {c["goldbridge_item_id"]: c for c in price_cards.get_enabled_cards_for_broadcast(None)}
    assert cards[price_cards.SPECIAL_CARD_MOTAFEREGHE_ID]["buy_price"] == 5_000_000
    assert cards[price_cards.SPECIAL_CARD_NAGHD_KARTKHAN_ID]["buy_price"] == 5_000_000
    assert cards[1]["buy_price"] == 5_000_000


def test_untick_manual_follows_live_despite_leftover_typed_prices():
    """Turning the flag off must ignore leftover manuals and use goldbridge."""
    price_cards._latest_items[1] = _live(12_000_000, 11_900_000)
    price_cards._manual_quotes[1] = {
        "use_manual": False,
        "buy": 1,
        "sell": 1,
    }
    src = _source(use_manual_price=False, manual_buy=1, manual_sell=1)

    own = price_cards._live_or_manual_item(src, price_cards._latest_items[1])
    assert own["price_source"] == "live"
    assert own["buy"] == 12_000_000

    mota = price_cards.resolve_effective_item(_mota(), None, source_card=src)
    naghd = price_cards.resolve_effective_item(_naghd(), None, source_card=src)
    assert mota["buy"] == 12_000_000
    assert naghd["buy"] == 12_000_000
    assert mota["mirrored_source_mode"] == "live"


def test_untick_manual_cache_beats_stale_orm_still_flagged_on():
    price_cards._latest_items[1] = _live(8_800_000, 8_700_000)
    price_cards._manual_quotes[1] = {
        "use_manual": False,
        "buy": 99_999_999,
        "sell": 99_999_999,
    }
    stale_on = _source(use_manual_price=True, manual_buy=99_999_999, manual_sell=99_999_999)
    mota = price_cards.resolve_effective_item(_mota(), None, source_card=stale_on)
    assert mota["buy"] == 8_800_000
    assert mota["mirrored_source_mode"] == "live"


def test_poll_does_not_overwrite_manual_last_update_clock():
    """Client «آخرین بروزرسانی» must stay on the admin save, not goldbridge."""
    manual_ts = "2026-09-08T10:00:00+00:00"
    source_ts = "2026-09-08T08:00:00+03:30"
    price_cards._manual_quotes[1] = {
        "use_manual": True,
        "buy": 5_000_000,
        "sell": 4_900_000,
    }
    price_cards.mark_item_price_changed(1, manual_ts)
    price_cards._merge_polled_items({
        1: {
            **_live(12_000_000, 11_900_000),
            "last_update_time": source_ts,
        },
    })
    assert price_cards.item_price_changed_at(1) == manual_ts


def test_broadcast_manual_card_uses_manual_clock():
    from types import SimpleNamespace

    manual_ts = "2026-09-08T11:30:00+00:00"
    price_cards._manual_quotes[1] = {
        "use_manual": True,
        "buy": 5_000_000,
        "sell": 4_900_000,
        "updated_at": manual_ts,
    }
    price_cards.mark_item_price_changed(1, manual_ts)
    price_cards._card_config_cache = [
        SimpleNamespace(
            goldbridge_item_id=1,
            display_name="نقد یکشنبه",
            use_manual_price=True,
            manual_buy=5_000_000,
            manual_sell=4_900_000,
            price_source_item_id=None,
            price_label_mode=None,
            is_enabled=True,
            orderable_buy=True,
            orderable_sell=True,
            override_source_restriction=True,
            sort_order=1,
            created_at=None,
            manual_updated_at=manual_ts,
        ),
        SimpleNamespace(
            goldbridge_item_id=price_cards.SPECIAL_CARD_MOTAFEREGHE_ID,
            display_name="متفرقه",
            use_manual_price=False,
            manual_buy=None,
            manual_sell=None,
            price_source_item_id=1,
            price_label_mode=None,
            is_enabled=True,
            orderable_buy=False,
            orderable_sell=True,
            override_source_restriction=True,
            sort_order=2,
            created_at=None,
            manual_updated_at=None,
        ),
    ]
    cards = {c["goldbridge_item_id"]: c for c in price_cards.get_enabled_cards_for_broadcast(None)}
    assert cards[1]["updated_at"] == manual_ts
    assert cards[price_cards.SPECIAL_CARD_MOTAFEREGHE_ID]["updated_at"] == manual_ts


def test_poll_updates_clock_again_after_manual_untick():
    price_cards._manual_quotes[1] = {"use_manual": False, "buy": 1, "sell": 1}
    price_cards.mark_item_price_changed(1, "2026-09-08T10:00:00+00:00")
    price_cards._merge_polled_items({
        1: {
            **_live(12_000_000, 11_900_000),
            "last_update_time": "2026-09-08T08:15:00+00:00",
        },
    })
    assert price_cards.item_price_changed_at(1) == "2026-09-08T08:15:00+00:00"


if __name__ == "__main__":
    setup_function()
    test_motaferaghe_follows_live_buy()
    setup_function()
    test_specials_follow_id1_manual_even_when_live_exists()
    setup_function()
    test_specials_follow_id1_manual_when_feed_is_down()
    setup_function()
    test_unavailable_when_feed_down_and_id1_not_manual()
    setup_function()
    test_uses_entered_manual_buy_not_sell_even_if_sell_missing()
    setup_function()
    test_manual_cache_wins_over_stale_source_card()
    setup_function()
    test_manual_cache_works_without_source_card_or_db()
    setup_function()
    test_ensure_specials_is_noop_once_ready()
    setup_function()
    test_broadcast_hot_path_uses_manual_cache_without_db()
    setup_function()
    test_untick_manual_follows_live_despite_leftover_typed_prices()
    setup_function()
    test_untick_manual_cache_beats_stale_orm_still_flagged_on()
    setup_function()
    test_poll_does_not_overwrite_manual_last_update_clock()
    setup_function()
    test_broadcast_manual_card_uses_manual_clock()
    setup_function()
    test_poll_updates_clock_again_after_manual_untick()
    print("ok")
