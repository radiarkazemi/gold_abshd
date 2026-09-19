
"""Per-role can_order must hide/block mirrored specials too."""
from types import SimpleNamespace
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services import price_cards


class _Q:
    def __init__(self, rows):
        self._rows = rows
    def filter(self, *a, **k):
        return self
    def first(self):
        return self._rows[0] if self._rows else None
    def all(self):
        return list(self._rows)


class _DB:
    def __init__(self, commissions=None, cards=None):
        self._commissions = commissions or []
        self._cards = cards or []
    def query(self, model):
        name = getattr(model, "__name__", str(model))
        if "Commission" in name:
            return _Q(self._commissions)
        return _Q(self._cards)


def test_resolve_can_order_denies_mirrored_special_for_role():
    card = SimpleNamespace(goldbridge_item_id=900001)
    user = SimpleNamespace(role_id="role-home")
    ov = SimpleNamespace(can_order=False, role_id="role-home", goldbridge_item_id=900001)
    db = _DB(commissions=[ov])
    # Mirrored effective item must still be denied.
    assert price_cards.resolve_can_order_for_user(
        db, user, card, {"price_source": "mirrored", "buy": 1, "sell": 1}
    ) is False


def test_resolve_can_order_allows_when_no_override():
    card = SimpleNamespace(goldbridge_item_id=900002)
    user = SimpleNamespace(role_id="role-home")
    db = _DB(commissions=[])
    assert price_cards.resolve_can_order_for_user(
        db, user, card, {"price_source": "mirrored", "buy": 1, "sell": 1}
    ) is True
