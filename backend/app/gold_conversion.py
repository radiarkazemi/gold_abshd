"""
Converts a per-مثقال۱۷ price into a per-گرم۱۸ price.

Market formula used by this business (default cards):
    گرم۱۸ = مثقال۱۷ / 4.3318

متفرقه (mirrored sell card) uses a different divisor:
    گرم۱۸ = (مثقال۱۷ + commission) / 4.39
"""

# Keep in sync with frontend/src/utils/priceCommission.js
MESGHAL17_TO_GRAM18 = 4.3318
# متفرقه بفروشید: (قیمت خرید id:1 + کارمزد) / 4.39
MOTAFEREGHE_TO_GRAM18 = 4.39


def mesghal17_to_gram18(mesghal17_price: float) -> float:
    return mesghal17_price / MESGHAL17_TO_GRAM18


def motaferaghe_to_gram18(mesghal17_price: float) -> float:
    return mesghal17_price / MOTAFEREGHE_TO_GRAM18