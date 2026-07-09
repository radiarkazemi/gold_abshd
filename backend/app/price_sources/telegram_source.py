"""
Reads gold prices from a Telegram channel in real time.

Uses Telethon (MTProto, not the Bot API) because it can read any public
channel's posts as soon as they arrive, without needing the channel
owner to add a bot as admin.

SETUP (one-time, do this on your own machine before running the server):
  1. Get an api_id/api_hash from https://my.telegram.org (log in with
     your own Telegram account, "API development tools").
  2. Put them in .env as GOLDAPP_TG_API_ID / GOLDAPP_TG_API_HASH.
  3. Run `python scripts/telegram_login.py` once. It will ask for your
     phone number and the login code Telegram sends you, then save a
     session file (GOLDAPP_TG_SESSION_NAME + ".session") so future runs
     don't need to log in again.
  4. Set GOLDAPP_TG_CHANNEL to the channel's @username.
  5. If Telegram is blocked on your network, set GOLDAPP_TG_PROXY_ENABLED.

MESSAGE FORMAT: this channel posts one message per price update, e.g.:
    **77,950,000**⏳باحواله🔵خرید
    گرم: **17,994,828**
Each buy/trade/sell update is a SEPARATE message. Each message contains
TWO numbers:
  - the leading bold number: the مثقال۱۷-equivalent price
  - the "گرم:" number: the channel's OWN real گرم۱۸ price
We use the channel's گرم۱۸ number directly rather than computing an
approximation from the مثقال price, since it's guaranteed to match the
source exactly. Messages containing neither خرید nor فروش (e.g.
"معامله" - trade executed) are skipped, since they aren't a buy/sell
quote.
"""
import re
import logging

from telethon import TelegramClient, events

from app.price_sources.base import PriceSource, OnPriceCallback
from app.config import settings

logger = logging.getLogger(__name__)


def build_proxy():
    """
    Returns a proxy tuple for Telethon (needs the `pysocks` package
    installed), or None if no proxy is configured. Used when Telegram is
    blocked on the network and needs to go through something like V2rayN.
    """
    if not settings.TG_PROXY_ENABLED:
        return None

    import socks  # from the `pysocks` package

    proxy_types = {
        "socks5": socks.SOCKS5,
        "socks4": socks.SOCKS4,
        "http": socks.HTTP,
    }
    proxy_type = proxy_types.get(settings.TG_PROXY_TYPE.lower())
    if proxy_type is None:
        raise ValueError(
            f"Unknown GOLDAPP_TG_PROXY_TYPE={settings.TG_PROXY_TYPE!r}. "
            f"Must be one of: socks5, socks4, http"
        )
    return (proxy_type, settings.TG_PROXY_HOST, settings.TG_PROXY_PORT)


def _extract_number(pattern: str, text: str) -> float | None:
    match = re.search(pattern, text)
    if not match:
        return None
    raw = match.group(1).replace(",", "").replace("،", "").strip()
    try:
        return float(raw)
    except ValueError:
        return None


def classify_message(text: str) -> tuple[str | None, float | None, float | None]:
    """
    Returns ("buy" | "sell" | "skip", mesghal17_price, gram18_price).
    Returns (None, None, None) if no مثقال price number could be found.
    """
    mesghal_price = _extract_number(settings.TG_PRICE_REGEX, text)
    if mesghal_price is None:
        return None, None, None

    gram18_price = _extract_number(settings.TG_GRAM18_REGEX, text)

    has_buy = settings.TG_BUY_KEYWORD in text
    has_sell = settings.TG_SELL_KEYWORD in text

    if has_buy and not has_sell:
        return "buy", mesghal_price, gram18_price
    if has_sell and not has_buy:
        return "sell", mesghal_price, gram18_price
    return "skip", mesghal_price, gram18_price


class TelegramPriceSource(PriceSource):
    def __init__(self):
        self.client = TelegramClient(
            settings.TG_SESSION_NAME,
            int(settings.TG_API_ID) if settings.TG_API_ID else 0,
            settings.TG_API_HASH,
            proxy=build_proxy(),
        )
        self._last_buy: float | None = None
        self._last_sell: float | None = None
        self._last_buy_gram18: float | None = None
        self._last_sell_gram18: float | None = None

    async def run(self, on_price: OnPriceCallback):
        if not (settings.TG_API_ID and settings.TG_API_HASH and settings.TG_CHANNEL):
            raise RuntimeError(
                "GOLDAPP_TG_API_ID / GOLDAPP_TG_API_HASH / GOLDAPP_TG_CHANNEL "
                "must be set in .env to use the telegram price source"
            )

        await self.client.start()
        logger.info(f"[telegram-price] connected, watching channel: {settings.TG_CHANNEL}")

        channel = await self.client.get_entity(settings.TG_CHANNEL)

        async def handle_text(text: str):
            kind, mesghal_price, gram18_price = classify_message(text)
            logger.info(
                f"[telegram-price] message -> kind={kind}, mesghal={mesghal_price}, "
                f"gram18={gram18_price} | raw={text[:200]!r}"
            )

            if kind is None or kind == "skip":
                return
            if kind == "buy":
                self._last_buy = mesghal_price
                self._last_buy_gram18 = gram18_price
            elif kind == "sell":
                self._last_sell = mesghal_price
                self._last_sell_gram18 = gram18_price

            if self._last_buy is not None and self._last_sell is not None:
                if self._last_buy == self._last_sell:
                    logger.warning(
                        f"[telegram-price] buy and sell came out equal "
                        f"({self._last_buy}) - not emitting this update"
                    )
                    return
                if self._last_sell < self._last_buy:
                    logger.warning(
                        f"[telegram-price] sell ({self._last_sell}) is lower than "
                        f"buy ({self._last_buy}) - unusual, emitting anyway but worth checking"
                    )
                logger.info(
                    f"[telegram-price] emitting: buy={self._last_buy}, sell={self._last_sell}, "
                    f"gram18_buy={self._last_buy_gram18}, gram18_sell={self._last_sell_gram18}"
                )
                await on_price(
                    self._last_buy,
                    self._last_sell,
                    self._last_buy_gram18,
                    self._last_sell_gram18,
                )

        # 1. Backfill from recent history so we have a starting pair
        #    immediately instead of waiting for two fresh posts.
        logger.info("[telegram-price] backfilling from recent channel history...")
        backfill_count = 0
        async for message in self.client.iter_messages(channel, limit=20):
            backfill_count += 1
            if message.text:
                await handle_text(message.text)
            else:
                logger.info(f"[telegram-price] message with no text (media-only?), id={message.id}")
            if self._last_buy is not None and self._last_sell is not None:
                break
        logger.info(
            f"[telegram-price] backfill done: scanned {backfill_count} messages, "
            f"last_buy={self._last_buy}, last_sell={self._last_sell}"
        )

        # 2. Then listen for every new post as it arrives.
        @self.client.on(events.NewMessage(chats=channel))
        async def _on_new_message(event):
            if event.message.text:
                await handle_text(event.message.text)

        await self.client.run_until_disconnected()