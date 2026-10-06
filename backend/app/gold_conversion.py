"""
Converts a per-مثقال۱۷ price into a per-گرم۱۸ price.

Market formula used by this business (default cards):
    گرم۱۸ = مثقال۱۷ / 4.3318

متفرقه (mirrored sell card) uses a different divisor:
    گرم۱۸ = (مثقال۱۷ + commission) / 4.39

متفرقه physical gold is عیار 740. Remaining gold in the shop books
is tracked as عیار 750 (گرم ۱۸), so a 740 weight is scaled by 740/750
before it is added to مانده طلا. Tahesab خرید متفرقه is entered in
مثقال۱۷, which is the inverse of the price formula above:
    مثقال۱۷ = گرم / 4.39
"""

# Keep in sync with frontend/src/utils/priceCommission.js
MESGHAL17_TO_GRAM18 = 4.3318
# متفرقه بفروشید: (قیمت خرید id:1 + کارمزد) / 4.39
MOTAFEREGHE_TO_GRAM18 = 4.39
MOTAFEREGHE_AYAR = 740.0
ABSHODE_AYAR = 750.0


def mesghal17_to_gram18(mesghal17_price: float) -> float:
    return mesghal17_price / MESGHAL17_TO_GRAM18


def motaferaghe_to_gram18(mesghal17_price: float) -> float:
    return mesghal17_price / MOTAFEREGHE_TO_GRAM18


def gram18_to_motaferaghe_mesghal17(gram_weight: float) -> float:
    """Inverse of motaferaghe_to_gram18 for quantities: مثقال۱۷ = گرم / 4.39."""
    return float(gram_weight) / MOTAFEREGHE_TO_GRAM18


def motaferaghe_weight_to_ayar750(weight_740: float) -> float:
    """Convert a 740-ayar weight into the equivalent 750-ayar (گرم ۱۸) weight."""
    return float(weight_740) * MOTAFEREGHE_AYAR / ABSHODE_AYAR


def motaferaghe_vazn_mesghal17(gram_weight_740: float) -> float:
    """App گرم of 740 متفرقه → Tahesab مثقال۱۷ after 740→750 soothe."""
    return gram18_to_motaferaghe_mesghal17(motaferaghe_weight_to_ayar750(gram_weight_740))


def mesghal17_weight_to_gram18(mesghal_weight: float) -> float:
    """Tahesab مانده وزنی (مثقال) → app گرم ۱۸. Inverse of the price divisor."""
    return float(mesghal_weight) * MESGHAL17_TO_GRAM18
