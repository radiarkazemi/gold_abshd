"""
Converts a per-مثقال۱۷ price into a per-گرم۱۸ price.

Formula: (price × 750 / 708) / 4.6083
  - 750 / 708 adjusts for purity: 18-karat gold is 750 parts per 1000
    pure, 17-karat is 708 parts per 1000.
  - 4.6083 converts from مثقال to گرم (1 مثقال = 4.6083 گرم).

NOTE: this was corrected from the client's originally-stated formula
(which divided by the literal number 17 instead of 708, the actual
17-karat purity-per-mille value) - the original produced a گرم۱۸ price
9.6x HIGHER than the مثقال۱۷ price, which is backwards for a smaller
unit. This version produces plausible real-world numbers. Flag for
confirmation before relying on this for anything customer-facing.
"""

MESGHAL_TO_GRAM = 4.6083
PURITY_18K = 750
PURITY_17K = 708


def mesghal17_to_gram18(mesghal17_price: float) -> float:
    return (mesghal17_price * PURITY_18K / PURITY_17K) / MESGHAL_TO_GRAM