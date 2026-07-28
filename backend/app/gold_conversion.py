"""
Converts a per-مثقال۱۷ price into a per-گرم۱۸ price.

Market formula used by this business:
    گرم۱۸ = مثقال۱۷ / 4.3318

Example: 79,620,000 / 4.3318 ≈ 18,380,350 تومان per گرم۱۸.
"""

# Keep in sync with frontend/src/utils/priceCommission.js
MESGHAL17_TO_GRAM18 = 4.3318


def mesghal17_to_gram18(mesghal17_price: float) -> float:
    return mesghal17_price / MESGHAL17_TO_GRAM18
