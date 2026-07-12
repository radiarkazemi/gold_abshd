"""
Shared Limiter instance. Lives in its own module (not main.py) so that
router modules can import it directly for @limiter.limit(...) decorators
without creating a circular import with main.py (which imports the
routers).
"""
from slowapi import Limiter
from slowapi.util import get_remote_address

limiter = Limiter(key_func=get_remote_address)