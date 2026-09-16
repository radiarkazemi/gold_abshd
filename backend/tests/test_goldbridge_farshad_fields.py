"""Goldbridge Farshad-screen fields + goldapp shop margin."""
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import settings
from app.services import price_cards


def setup_function():
    price_cards._latest_items.clear()
    price_cards._manual_quotes.clear()
    price_cards._item_price_changed_at.clear()
    price_cards._latest_updated_at = None
    price_cards._card_config_cache = None
    price_cards._specials_ready = False
    settings.EXTRA_SHOP_MARGIN_TOMAN = 0
    settings.PRICE_API_RIAL_TO_TOMAN = True


def test_clean_goldbridge_item_converts_rial_and_keeps_farshad_fields():
    row = price_cards.clean_goldbridge_item({
        "id": 1013,
        "name": "نقدی یکشنبه",
        "type": 1,
        "buy": 1_038_200_000.0,
        "sell": 1_036_800_000.0,
        "base_price": 1_037_500_000.0,
        "profit": 700_000.0,
        "master_profit": 0.0,
        "farshad_commission": 700_000.0,
        "farshad_spread": 1_400_000.0,
        "stale": False,
        "related_id": 1,
        "active": True,
        "allow_buy": True,
        "allow_sell": True,
        "source_updated_at": "2026-09-12 11:42:15",
    })
    assert row["goldbridge_item_id"] == 1013
    assert row["name"] == "نقدی یکشنبه"
    assert row["buy"] == 103_820_000
    assert row["sell"] == 103_680_000
    assert row["base_price"] == 103_750_000
    assert row["farshad_commission"] == 70_000
    assert row["farshad_spread"] == 140_000
    assert row["profit"] == 70_000
    assert row["related_id"] == 1
    assert row["stale"] is False
    assert row["last_update_time"] == "2026-09-12 11:42:15"


def test_live_shop_margin_pads_farshad_quotes_when_configured():
    settings.EXTRA_SHOP_MARGIN_TOMAN = 10_000
    src = type("C", (), {
        "goldbridge_item_id": 1013,
        "display_name": "نقدی یکشنبه",
        "use_manual_price": False,
        "manual_buy": None,
        "manual_sell": None,
    })()
    live = price_cards.clean_goldbridge_item({
        "id": 1013,
        "name": "نقدی یکشنبه",
        "type": 1,
        "buy": 1_038_200_000.0,
        "sell": 1_036_800_000.0,
        "allow_buy": True,
        "allow_sell": True,
        "active": True,
    })
    out = price_cards._live_or_manual_item(src, live)
    assert out["price_source"] == "live"
    assert out["farshad_buy"] == 103_820_000
    assert out["farshad_sell"] == 103_680_000
    assert out["shop_margin_toman"] == 10_000
    assert out["buy"] == 103_830_000
    assert out["sell"] == 103_670_000


def test_default_shop_margin_is_off_customer_sees_farshad_buy():
    settings.EXTRA_SHOP_MARGIN_TOMAN = 0
    src = type("C", (), {
        "goldbridge_item_id": 1013,
        "display_name": "نقدی یکشنبه",
        "use_manual_price": False,
        "manual_buy": None,
        "manual_sell": None,
    })()
    live = price_cards.clean_goldbridge_item({
        "id": 1013,
        "name": "نقدی یکشنبه",
        "type": 1,
        "buy": 1_038_200_000.0,
        "sell": 1_036_800_000.0,
        "allow_buy": True,
        "allow_sell": True,
        "active": True,
    })
    out = price_cards._live_or_manual_item(src, live)
    assert out["buy"] == 103_820_000
    assert out["sell"] == 103_680_000
    assert out["shop_margin_toman"] == 0
    assert out["buy"] == out["farshad_buy"]


def test_manual_quote_is_not_padded():
    src = type("C", (), {
        "goldbridge_item_id": 1,
        "display_name": "نقد یکشنبه",
        "use_manual_price": True,
        "manual_buy": 5_000_000,
        "manual_sell": 4_900_000,
    })()
    price_cards._manual_quotes[1] = {"use_manual": True, "buy": 5_000_000, "sell": 4_900_000}
    out = price_cards._live_or_manual_item(src, {"buy": 12_000_000, "sell": 11_900_000, "type": 1})
    assert out["price_source"] == "manual"
    assert out["buy"] == 5_000_000
    assert out["sell"] == 4_900_000


def test_mirrored_cards_follow_live_farshad_trade_buy():
    """Live specials track id:1013 Farshad buy (id:1 is often frozen)."""
    id1_buy = 12_000_000
    trade_buy = 12_040_000
    price_cards._latest_items[1] = {
        "goldbridge_item_id": 1,
        "name": "نقد یکشنبه",
        "type": 1,
        "buy": id1_buy,
        "sell": 11_900_000,
        "allow_buy": True,
        "allow_sell": True,
        "active": False,
    }
    price_cards._latest_items[1013] = {
        "goldbridge_item_id": 1013,
        "name": "نقدی یکشنبه",
        "type": 1,
        "buy": trade_buy,
        "sell": 11_860_000,
        "allow_buy": True,
        "allow_sell": True,
        "active": True,
    }
    src = type("C", (), {
        "goldbridge_item_id": 1,
        "display_name": "نقد یکشنبه",
        "use_manual_price": False,
        "manual_buy": None,
        "manual_sell": None,
        "price_source_item_id": None,
    })()
    mota = type("C", (), {
        "goldbridge_item_id": price_cards.SPECIAL_CARD_MOTAFEREGHE_ID,
        "display_name": "متفرقه",
        "use_manual_price": False,
        "manual_buy": None,
        "manual_sell": None,
        "price_source_item_id": 1,
    })()
    naghd = type("C", (), {
        "goldbridge_item_id": price_cards.SPECIAL_CARD_NAGHD_KARTKHAN_ID,
        "display_name": "نقد کارتخوان",
        "use_manual_price": False,
        "manual_buy": None,
        "manual_sell": None,
        "price_source_item_id": 1,
    })()
    mota_out = price_cards.resolve_effective_item(mota, None, source_card=src)
    naghd_out = price_cards.resolve_effective_item(naghd, None, source_card=src)
    assert mota_out["buy"] == trade_buy
    assert naghd_out["buy"] == trade_buy
    assert mota_out["buy"] != id1_buy
    assert mota_out["mirrored_source_mode"] == "live"
    assert naghd_out.get("mirrored_from") == 1013
    assert naghd_out.get("shop_margin_toman") in (0, None)


def test_mirrored_cards_id1_manual_overrides_trade_tile():
    trade_buy = 12_040_000
    manual_buy = 11_500_000
    price_cards._latest_items[1] = {
        "goldbridge_item_id": 1,
        "name": "نقد یکشنبه",
        "type": 1,
        "buy": 12_000_000,
        "sell": 11_900_000,
        "allow_buy": True,
        "allow_sell": True,
        "active": False,
    }
    price_cards._latest_items[1013] = {
        "goldbridge_item_id": 1013,
        "name": "نقدی یکشنبه",
        "type": 1,
        "buy": trade_buy,
        "sell": 11_860_000,
        "allow_buy": True,
        "allow_sell": True,
        "active": True,
    }
    price_cards._manual_quotes[1] = {"use_manual": True, "buy": manual_buy, "sell": manual_buy}
    src = type("C", (), {
        "goldbridge_item_id": 1,
        "display_name": "نقد یکشنبه",
        "use_manual_price": True,
        "manual_buy": manual_buy,
        "manual_sell": manual_buy,
        "price_source_item_id": None,
    })()
    mota = type("C", (), {
        "goldbridge_item_id": price_cards.SPECIAL_CARD_MOTAFEREGHE_ID,
        "display_name": "متفرقه",
        "use_manual_price": False,
        "manual_buy": None,
        "manual_sell": None,
        "price_source_item_id": 1,
    })()
    out = price_cards.resolve_effective_item(mota, None, source_card=src)
    assert out["buy"] == manual_buy
    assert out["mirrored_source_mode"] == "manual"
    assert out.get("mirrored_from") == 1



def test_card_list_rank_puts_nagh_farda_then_kartkhan_then_mota():
    """Shop order: نقد فردا (900000) → کارتخوان → متفرقه → id:1 → others."""
    ranked = sorted(
        [1, 50, 1013, 900000, 900002, 900001],
        key=lambda i: price_cards.card_list_rank(i, 0, in_use=i in {50}),
    )
    assert ranked == [900000, 900002, 900001, 1, 50, 1013]


def test_only_900000_is_main_cash_not_weekday_ids():
    assert price_cards.is_main_cash_item_id(900000) is True
    assert price_cards.is_main_cash_item_id(1013) is False
    assert price_cards.is_main_cash_item_id(1009) is False
    assert price_cards.is_legacy_weekday_cash_id(1013) is True
    assert price_cards.is_legacy_weekday_cash_id(900000) is False


def test_coins_do_not_get_shop_margin():
    src = type("C", (), {
        "goldbridge_item_id": 50,
        "display_name": "سکه",
        "use_manual_price": False,
        "manual_buy": None,
        "manual_sell": None,
    })()
    live = {"goldbridge_item_id": 50, "name": "سکه", "type": 2, "buy": 80_000_000, "sell": 79_000_000}
    out = price_cards._live_or_manual_item(src, live)
    assert out["buy"] == 80_000_000
    assert out["shop_margin_toman"] == 0


def test_frozen_1013_follows_tomorrow_farshad_day():
    """Main cash 900000 overlays goldbridge tomorrow tile (Sunday → دوشنبه/1009)."""
    from datetime import datetime
    from zoneinfo import ZoneInfo

    price_cards._latest_items[1013] = {
        "goldbridge_item_id": 1013,
        "name": "نقدی یکشنبه",
        "type": 1,
        "buy": 102_030_000,
        "sell": 101_890_000,
        "active": False,
        "allow_buy": True,
        "allow_sell": True,
    }
    price_cards._latest_items[1009] = {
        "goldbridge_item_id": 1009,
        "name": "نقدی دوشنبه",
        "type": 1,
        "buy": 102_850_000,
        "sell": 102_730_000,
        "active": True,
        "allow_buy": True,
        "allow_sell": True,
    }
    price_cards._latest_items[1010] = {
        "goldbridge_item_id": 1010,
        "name": "نقدی سه‌شنبه",
        "type": 1,
        "buy": 103_140_000,
        "sell": 103_000_000,
        "active": True,
        "allow_buy": True,
        "allow_sell": True,
    }
    # Alias 900000 intentionally absent → resolve falls back to tomorrow weekday tile.
    sunday = datetime(2026, 9, 13, 16, 0, tzinfo=ZoneInfo("Asia/Tehran"))
    live = price_cards.resolve_live_farshad_cash_item(now=sunday)
    assert live["goldbridge_item_id"] == 1009
    card = type("C", (), {
        "goldbridge_item_id": 900000,
        "display_name": None,
        "use_manual_price": False,
        "manual_buy": None,
        "manual_sell": None,
    })()
    # Shop card live row may be missing; overlay still fills from tomorrow Farshad.
    stub = {
        "goldbridge_item_id": 900000,
        "name": "نقدی",
        "type": 1,
        "buy": 102_030_000,
        "sell": 101_890_000,
        "active": True,
        "allow_buy": True,
        "allow_sell": True,
    }
    out = price_cards._live_or_manual_item(card, stub)
    assert out["buy"] == 102_850_000
    assert out.get("live_from_item_id") == 1009
    assert out["name"] == "نقدی دوشنبه"
    assert out.get("live_from_name") == "نقدی دوشنبه"

    # Leftover weekday pin (1013) is NOT the main card — no tomorrow overlay.
    weekday = type("C", (), {
        "goldbridge_item_id": 1013,
        "display_name": "نقدی یکشنبه",
        "use_manual_price": False,
        "manual_buy": None,
        "manual_sell": None,
    })()
    weekday_out = price_cards._live_or_manual_item(weekday, price_cards._latest_items[1013])
    assert weekday_out["buy"] == 102_030_000
    assert weekday_out.get("live_from_item_id") is None

    mota = type("C", (), {
        "goldbridge_item_id": price_cards.SPECIAL_CARD_MOTAFEREGHE_ID,
        "display_name": "متفرقه",
        "use_manual_price": False,
        "manual_buy": None,
        "manual_sell": None,
        "price_source_item_id": 1,
    })()
    src = type("C", (), {
        "goldbridge_item_id": 1,
        "display_name": "نقد یکشنبه",
        "use_manual_price": False,
        "manual_buy": None,
        "manual_sell": None,
        "price_source_item_id": None,
    })()
    mota_out = price_cards.resolve_effective_item(mota, None, source_card=src)
    assert mota_out["buy"] == 102_850_000
    assert mota_out.get("mirrored_from") == 1009


def test_main_trade_card_name_follows_goldbridge_tomorrow_even_if_inactive():
    """Tuesday → نقدی چهارشنبه (1011) on main card 900000 when alias is missing."""
    from datetime import datetime
    from unittest.mock import patch
    from zoneinfo import ZoneInfo

    price_cards._latest_items[1013] = {
        "goldbridge_item_id": 1013,
        "name": "نقدی یکشنبه",
        "type": 1,
        "buy": 102_030_000,
        "sell": 101_890_000,
        "active": False,
        "allow_buy": True,
        "allow_sell": True,
    }
    price_cards._latest_items[1011] = {
        "goldbridge_item_id": 1011,
        "name": "نقدی چهارشنبه",
        "type": 1,
        "buy": 100_940_000,
        "sell": 100_780_000,
        "active": False,
        "allow_buy": True,
        "allow_sell": True,
    }
    price_cards._latest_items[1010] = {
        "goldbridge_item_id": 1010,
        "name": "نقدی سه‌شنبه",
        "type": 1,
        "buy": 100_400_000,
        "sell": 100_260_000,
        "active": False,
        "allow_buy": True,
        "allow_sell": True,
    }
    tuesday = datetime(2026, 9, 15, 10, 30, tzinfo=ZoneInfo("Asia/Tehran"))
    live = price_cards.resolve_live_farshad_cash_item(now=tuesday)
    assert live["goldbridge_item_id"] == 1011
    assert live["name"] == "نقدی چهارشنبه"
    card = type("C", (), {
        "goldbridge_item_id": 900000,
        "display_name": "نقدی",  # generic shop label must not win
        "use_manual_price": False,
        "manual_buy": None,
        "manual_sell": None,
    })()
    stub = {
        "goldbridge_item_id": 900000,
        "name": "نقدی",
        "type": 1,
        "buy": 102_030_000,
        "sell": 101_890_000,
        "active": True,
        "allow_buy": True,
        "allow_sell": True,
    }
    # Overlay uses wall-clock; pin next-open day to چهارشنبه for this case.
    with patch.object(price_cards, "_next_open_weekday_fa", return_value="چهارشنبه"):
        out = price_cards._live_or_manual_item(card, stub)
    assert out["buy"] == 100_940_000
    assert out["name"] == "نقدی چهارشنبه"
    assert out.get("live_from_item_id") == 1011


def test_next_open_weekday_skips_thursday_and_friday():
    """پنجشنبه + جمعه are closed → Wednesday/Thursday jump to شنبه."""
    from datetime import datetime
    from zoneinfo import ZoneInfo

    wed = datetime(2026, 9, 16, 12, 0, tzinfo=ZoneInfo("Asia/Tehran"))
    thu = datetime(2026, 9, 17, 12, 0, tzinfo=ZoneInfo("Asia/Tehran"))
    fri = datetime(2026, 9, 18, 12, 0, tzinfo=ZoneInfo("Asia/Tehran"))
    sun = datetime(2026, 9, 13, 16, 0, tzinfo=ZoneInfo("Asia/Tehran"))
    assert price_cards._next_open_weekday_fa(wed) == "شنبه"
    assert price_cards._next_open_weekday_fa(thu) == "شنبه"
    assert price_cards._next_open_weekday_fa(fri) == "شنبه"
    assert price_cards._next_open_weekday_fa(sun) == "دوشنبه"


def test_wednesday_main_and_specials_follow_shanbeh_not_panjshanbeh():
    """On Wednesday, ignore closed پنجشنبه alias and use نقدی شنبه."""
    from datetime import datetime
    from zoneinfo import ZoneInfo

    # Goldbridge alias wrongly still pointing at closed پنجشنبه (live bug).
    price_cards._latest_items[900000] = {
        "goldbridge_item_id": 900000,
        "name": "نقد پنجشنبه",
        "type": 1,
        "buy": 82_005_000,
        "sell": 81_995_000,
        "active": True,
        "allow_buy": True,
        "allow_sell": True,
    }
    price_cards._latest_items[2] = {
        "goldbridge_item_id": 2,
        "name": "نقد پنجشنبه",
        "type": 1,
        "buy": 82_005_000,
        "sell": 81_995_000,
        "active": False,
        "allow_buy": True,
        "allow_sell": True,
    }
    price_cards._latest_items[1012] = {
        "goldbridge_item_id": 1012,
        "name": "نقدی شنبه",
        "type": 1,
        "buy": 102_220_000,
        "sell": 102_080_000,
        "active": True,
        "allow_buy": True,
        "allow_sell": True,
    }
    price_cards._latest_items[1011] = {
        "goldbridge_item_id": 1011,
        "name": "نقدی چهارشنبه",
        "type": 1,
        "buy": 101_990_000,
        "sell": 101_850_000,
        "active": False,
        "allow_buy": True,
        "allow_sell": True,
    }

    wed = datetime(2026, 9, 16, 12, 0, tzinfo=ZoneInfo("Asia/Tehran"))
    live = price_cards.resolve_live_farshad_cash_item(now=wed)
    assert live["goldbridge_item_id"] == 1012
    assert live["name"] == "نقدی شنبه"

    card = type("C", (), {
        "goldbridge_item_id": 900000,
        "display_name": None,
        "use_manual_price": False,
        "manual_buy": None,
        "manual_sell": None,
    })()
    out = price_cards._live_or_manual_item(card, price_cards._latest_items[900000])
    assert out["buy"] == 102_220_000
    assert out["name"] == "نقدی شنبه"
    assert out.get("live_from_item_id") == 1012

    mota = type("C", (), {
        "goldbridge_item_id": price_cards.SPECIAL_CARD_MOTAFEREGHE_ID,
        "display_name": "متفرقه",
        "use_manual_price": False,
        "manual_buy": None,
        "manual_sell": None,
        "price_source_item_id": price_cards.MAIN_CASH_ITEM_ID,
    })()
    src = type("C", (), {
        "goldbridge_item_id": 900000,
        "display_name": None,
        "use_manual_price": False,
        "manual_buy": None,
        "manual_sell": None,
        "price_source_item_id": None,
    })()
    mota_out = price_cards.resolve_effective_item(mota, None, source_card=src)
    assert mota_out["buy"] == 102_220_000
    assert mota_out.get("mirrored_from") == 1012

    kart = type("C", (), {
        "goldbridge_item_id": price_cards.SPECIAL_CARD_NAGHD_KARTKHAN_ID,
        "display_name": "نقد کارتخوان",
        "use_manual_price": False,
        "manual_buy": None,
        "manual_sell": None,
        "price_source_item_id": price_cards.MAIN_CASH_ITEM_ID,
    })()
    kart_out = price_cards.resolve_effective_item(kart, None, source_card=src)
    assert kart_out["buy"] == 102_220_000
    assert kart_out.get("mirrored_from") == 1012


def test_shanbeh_name_does_not_match_seshanbeh_or_yekshanbeh():
    assert price_cards._name_has_weekday("نقدی شنبه", "شنبه") is True
    assert price_cards._name_has_weekday("نقدی سه‌شنبه", "شنبه") is False
    assert price_cards._name_has_weekday("نقدی دوشنبه", "شنبه") is False
    assert price_cards._name_has_weekday("نقدی یکشنبه", "شنبه") is False
    assert price_cards._name_has_weekday("نقدی چهارشنبه", "شنبه") is False
