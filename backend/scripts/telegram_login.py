"""
Run this ONCE, manually, from a terminal (not from an IDE's "run" button
that doesn't give you an interactive terminal - it needs to prompt you
for input):

    python scripts/telegram_login.py

It will ask for your phone number (with country code, e.g. +989121234567),
then the login code Telegram sends you (as a message in the Telegram app
itself, on another device - not SMS, unless you don't have Telegram
anywhere else logged in), and your 2FA password if you have one enabled
on your account. After that it saves a session file, and the server can
connect as this Telegram account without asking again.

Requires GOLDAPP_TG_API_ID and GOLDAPP_TG_API_HASH to already be set in
.env (get them from https://my.telegram.org). If Telegram is blocked on
your network, also set GOLDAPP_TG_PROXY_ENABLED=true and the proxy
settings (see .env.example) - this script uses the same proxy config as
the running server.
"""
import asyncio
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from telethon import TelegramClient
from app.config import settings
from app.price_sources.telegram_source import build_proxy


async def main():
    if not settings.TG_API_ID or not settings.TG_API_HASH:
        print("ERROR: set GOLDAPP_TG_API_ID and GOLDAPP_TG_API_HASH in .env first.")
        print("Get them from https://my.telegram.org (log in, 'API development tools').")
        return

    proxy = build_proxy()
    if proxy:
        print(f"Using proxy: {settings.TG_PROXY_TYPE}://{settings.TG_PROXY_HOST}:{settings.TG_PROXY_PORT}")
    else:
        print("No proxy configured (GOLDAPP_TG_PROXY_ENABLED is not true) - connecting directly.")

    client = TelegramClient(
        settings.TG_SESSION_NAME,
        int(settings.TG_API_ID),
        settings.TG_API_HASH,
        proxy=proxy,
    )

    print("\nConnecting to Telegram...")
    await client.start()  # prompts for phone / code / 2FA password interactively
    me = await client.get_me()
    print(f"\nLogged in as: {me.first_name} (@{me.username})")
    print(f"Session saved as: {settings.TG_SESSION_NAME}.session")
    print("You can now set GOLDAPP_PRICE_SOURCE=telegram and start the server normally.")
    await client.disconnect()


if __name__ == "__main__":
    asyncio.run(main())