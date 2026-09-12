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
    settings.EXTRA_SHOP_MARGIN_TOMAN = 10_000
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


def test_live_shop_margin_pads_farshad_quotes():
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
    assert out["buy"] >= out["farshad_buy"] + 10_000
    assert out["sell"] <= out["farshad_sell"] - 10_000


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


def test_mirrored_cards_use_raw_id1_buy_not_shop_padded():
    farshad_buy = 12_000_000
    price_cards._latest_items[1] = {
        "goldbridge_item_id": 1,
        "name": "نقد یکشنبه",
        "type": 1,
        "buy": farshad_buy,
        "sell": 11_900_000,
        "allow_buy": True,
        "allow_sell": True,
        "active": True,
    }
    price_cards._latest_items[1013] = {
        "goldbridge_item_id": 1013,
        "name": "نقدی یکشنبه",
        "type": 1,
        "buy": farshad_buy + 40_000,
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
    wrong_src = type("C", (), {
        "goldbridge_item_id": 1013,
        "display_name": "نقدی یکشنبه",
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
        # Even if a row was wrongly pointed at 1013, formula source stays id:1.
        "price_source_item_id": 1013,
    })()
    own = price_cards.resolve_effective_item(src, price_cards._latest_items[1])
    assert own["buy"] == farshad_buy + 10_000
    mota_out = price_cards.resolve_effective_item(mota, None, source_card=src)
    naghd_out = price_cards.resolve_effective_item(naghd, None, source_card=wrong_src)
    assert mota_out["buy"] == farshad_buy
    assert naghd_out["buy"] == farshad_buy
    assert naghd_out["buy"] != price_cards._latest_items[1013]["buy"]
    assert mota_out["mirrored_source_mode"] == "live"
    assert naghd_out.get("mirrored_from") == 1
    assert naghd_out.get("shop_margin_toman") in (0, None)


def test_card_list_rank_puts_trade_tile_first():
    ranked = sorted(
        [1, 50, 1013, 900002, 900001],
        key=lambda i: price_cards.card_list_rank(i, 0, in_use=i in {50}),
    )
    assert ranked == [1013, 900001, 900002, 1, 50]


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
