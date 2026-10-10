"""Live min مبلغ follows 1g × realtime گرم۱۸."""
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services import order_limits


def test_get_effective_limits_derives_min_amount_from_global_min_weight():
    db = MagicMock()
    user = SimpleNamespace(role=None, is_trading_banned=False, kyc_status="approved")

    with (
        patch.object(
            order_limits,
            "get_order_limits",
            return_value={
                "min_weight": 1.0,
                "max_weight": 200.0,
                "min_amount": 0.0,
                "max_amount": 0.0,
            },
        ),
        patch.object(
            order_limits,
            "live_amount_limits_from_weights",
            return_value=(12_500_000, 2_500_000_000),
        ) as live,
        patch("app.services.price_cards.card_commissions_for_user", return_value=[]),
    ):
        out = order_limits.get_effective_limits(db, user)

    assert out["amount_limits_follow_weight"] is True
    assert out["min_amount"] == 12_500_000
    assert out["max_amount"] == 2_500_000_000
    live.assert_called_once()
    assert live.call_args.kwargs["min_weight"] == 1.0
    assert live.call_args.kwargs["max_weight"] == 200.0


def test_create_order_amount_rejects_below_one_gram_equivalent():
    from fastapi import HTTPException
    from app.services import orders

    db = MagicMock()
    user = SimpleNamespace(id="u1", role=None)
    raw = {
        "type": 1,
        "buy": 100_000_000,
        "sell": 99_000_000,
    }

    with (
        patch.object(
            orders.price_cards,
            "resolve_commission_for_user",
            return_value=("fixed", 0.0, 0.0),
        ),
        patch.object(
            orders.price_cards,
            "is_motaferaghe_card",
            return_value=False,
        ),
        patch.object(
            orders.price_cards,
            "is_naghd_kartkhan_card",
            return_value=False,
        ),
        patch.object(
            orders,
            "_price_gold_order",
            return_value=(100_000_000, 100_000_000, 10_000_000),  # gram18 unit
        ),
        patch.object(
            orders,
            "get_effective_limits",
            return_value={
                "min_weight": 1.0,
                "max_weight": 200.0,
                "min_amount": 10_000_000,
                "max_amount": 0,
            },
        ),
    ):
        try:
            orders.create_order(
                db,
                user,
                side="buy",
                amount_type="amount",
                value=5_000_000,  # 0.5g at 10M/g
                description="",
                goldbridge_item_id=1,
                raw_item=raw,
            )
            raised = None
        except HTTPException as exc:
            raised = exc

    assert raised is not None
    assert raised.status_code == 400
    assert "گرم" in raised.detail or "تومان" in raised.detail
