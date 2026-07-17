"""
Every permission scope a sub-admin can be granted. Keys match the
admin panel's tab keys (frontend/src/components/AdminShell.jsx
NAV_ITEMS) 1:1, so granting a scope = unlocking that tab.

The super-admin (env-based credentials) implicitly has every scope
and never needs to be granted anything explicitly.
"""

PERMISSION_SCOPES = {
    "dashboard": "داشبورد",
    "orders": "سفارش‌ها",
    "phone-order": "حواله تلفنی",
    "users": "کاربران",
    "add-user": "کاربر جدید",
    "roles": "دسته‌بندی‌ها",
    "prices": "قیمت‌ها",
    "calendar": "تقویم",
    "notice": "اطلاعیه",
    "kyc": "احراز هویت",
    "transfers": "ثبت حواله",
}


def is_valid_scope(scope: str) -> bool:
    return scope in PERMISSION_SCOPES


def valid_scopes(scopes: list[str]) -> list[str]:
    return [s for s in scopes if is_valid_scope(s)]
