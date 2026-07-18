"""
Reversible obfuscation for price payloads sent to the browser (REST
and WebSocket) - so glancing at the Network / WS-frames tab in
DevTools doesn't show plain "buy_price": 80005000 style JSON.

IMPORTANT - what this is and isn't:
  - It IS a real deterrent against casual inspection: someone opening
    the Network tab or the WS frames viewer sees an opaque base64
    blob, not readable numbers.
  - It is NOT encryption and provides NO security guarantee. The
    browser has to decode this to render the price, which means the
    decode key/logic ships in the frontend JS bundle - anyone who
    opens the Console (not just the Network tab) and calls the same
    decode function the page already uses gets the plaintext
    instantly. There is no scheme that can render data to a page
    while also keeping it secret from that page's own user - this is
    a fundamental property of client-side rendering, not a limitation
    of this implementation specifically.
  - Treat GOLDAPP_PAYLOAD_OBFUSCATION_KEY as a "raise the bar for
    casual snooping" setting, not a secret worth protecting like an
    API key or password.

Scheme: JSON -> UTF-8 bytes -> XOR against a repeating key -> base64.
Deliberately simple and fast (runs on every price tick); the frontend
mirrors this exact scheme in src/utils/payloadCodec.js.
"""
import base64
import json
import os

_KEY = os.getenv("GOLDAPP_PAYLOAD_OBFUSCATION_KEY", "goldapp-default-key-change-me").encode()


def _xor(data: bytes, key: bytes) -> bytes:
    return bytes(b ^ key[i % len(key)] for i, b in enumerate(data))


def encode_payload(data: dict) -> str:
    raw = json.dumps(data, default=str).encode("utf-8")
    return base64.b64encode(_xor(raw, _KEY)).decode("ascii")


def decode_payload(encoded: str) -> dict:
    """Not currently used server-side (the server only encodes outgoing
    data), but kept symmetric for tests/debugging."""
    raw = _xor(base64.b64decode(encoded), _KEY)
    return json.loads(raw.decode("utf-8"))