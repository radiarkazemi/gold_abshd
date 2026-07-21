"""
Database setup.

On startup, this module:
1. Connects to Postgres' default 'postgres' database and creates our
   app database (e.g. "goldapp") if it doesn't already exist.
2. Connects to the app database and creates all tables if they don't
   already exist.

This means nobody ever has to run `psql` or write SQL by hand - just
set the DB_* values in .env (matching whatever Postgres install already
exists on the machine) and start the server.
"""
import psycopg2
from psycopg2 import sql
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base

from app.config import settings

Base = declarative_base()


def ensure_database_exists():
    """Connects to the default 'postgres' db and creates our app db if missing."""
    conn = psycopg2.connect(
        host=settings.DB_HOST,
        port=settings.DB_PORT,
        user=settings.DB_USER,
        password=settings.DB_PASSWORD,
        dbname="postgres",
    )
    conn.autocommit = True  # CREATE DATABASE can't run inside a transaction
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT 1 FROM pg_database WHERE datname = %s", (settings.DB_NAME,)
            )
            exists = cur.fetchone() is not None
            if not exists:
                cur.execute(
                    sql.SQL("CREATE DATABASE {}").format(
                        sql.Identifier(settings.DB_NAME)
                    )
                )
                print(f"[db] Created database '{settings.DB_NAME}'")
            else:
                print(f"[db] Database '{settings.DB_NAME}' already exists")
    finally:
        conn.close()


engine = create_engine(settings.DATABASE_URL, pool_pre_ping=True)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def _patch_admin_users_table():
    """
    admin_users may already exist from before phone/OTP fields were
    added to the AdminUser model - create_all() only creates missing
    TABLES, it never alters existing ones. This adds any missing
    columns in place, safe to run every startup (IF NOT EXISTS), and
    drops the old NOT NULL "display_name" column (renamed to
    full_name) if a pre-rename install still has it - otherwise every
    insert fails with a NotNullViolation on a column nothing writes to
    anymore.
    """
    from sqlalchemy import text
    statements = [
        "ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS phone_number VARCHAR",
        "ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS national_id VARCHAR",
        "ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS full_name VARCHAR",
        "ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS registration_key VARCHAR",
        "ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS registration_key_expires_at TIMESTAMP",
        "ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS activated_at TIMESTAMP",
        "ALTER TABLE admin_users DROP COLUMN IF EXISTS display_name",
    ]
    with engine.connect() as conn:
        for stmt in statements:
            conn.execute(text(stmt))
        conn.commit()


def _patch_users_table():
    """users already exists - add the KYC columns in place if missing."""
    from sqlalchemy import text
    statements = [
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS kyc_status VARCHAR NOT NULL DEFAULT 'none'",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS kyc_document_path VARCHAR",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS kyc_submitted_at TIMESTAMP",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS kyc_reviewed_at TIMESTAMP",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS kyc_reject_reason VARCHAR",
    ]
    with engine.connect() as conn:
        for stmt in statements:
            conn.execute(text(stmt))
        conn.commit()


def _patch_orders_table():
    """orders already exists - add the newer columns in place if missing."""
    from sqlalchemy import text
    with engine.connect() as conn:
        conn.execute(text(
            "ALTER TABLE orders ADD COLUMN IF NOT EXISTS mesghal17_raw_price_at_submit FLOAT"
        ))
        conn.execute(text(
            "ALTER TABLE orders ADD COLUMN IF NOT EXISTS goldbridge_item_id INTEGER"
        ))
        conn.commit()


def _patch_roles_table():
    """roles already exists - add per-role limit/display columns in place if missing."""
    from sqlalchemy import text
    statements = [
        "ALTER TABLE roles ADD COLUMN IF NOT EXISTS min_weight FLOAT",
        "ALTER TABLE roles ADD COLUMN IF NOT EXISTS max_weight FLOAT",
        "ALTER TABLE roles ADD COLUMN IF NOT EXISTS min_amount FLOAT",
        "ALTER TABLE roles ADD COLUMN IF NOT EXISTS max_amount FLOAT",
        "ALTER TABLE roles ADD COLUMN IF NOT EXISTS price_label_mode VARCHAR NOT NULL DEFAULT 'mesghal_and_gram18'",
    ]
    with engine.connect() as conn:
        for stmt in statements:
            conn.execute(text(stmt))
        conn.commit()


def _patch_balance_transactions_table():
    """balance_transactions already exists - add goldbridge_item_id in place if missing."""
    from sqlalchemy import text
    with engine.connect() as conn:
        conn.execute(text(
            "ALTER TABLE balance_transactions ADD COLUMN IF NOT EXISTS goldbridge_item_id INTEGER"
        ))
        conn.commit()


def _patch_price_cards_table():
    """
    price_cards already exists from an earlier version that had a single
    is_orderable column - replace it with the two independent
    orderable_buy/orderable_sell columns (any number of cards can now be
    orderable, not just one, and buy/sell toggle independently).
    """
    from sqlalchemy import text
    with engine.connect() as conn:
        conn.execute(text(
            "ALTER TABLE price_cards ADD COLUMN IF NOT EXISTS orderable_buy BOOLEAN NOT NULL DEFAULT false"
        ))
        conn.execute(text(
            "ALTER TABLE price_cards ADD COLUMN IF NOT EXISTS orderable_sell BOOLEAN NOT NULL DEFAULT false"
        ))
        conn.execute(text(
            "ALTER TABLE price_cards ADD COLUMN IF NOT EXISTS override_source_restriction BOOLEAN NOT NULL DEFAULT false"
        ))
        # Carry over whatever the old single-flag value was, if that
        # column still exists, before dropping it.
        conn.execute(text("""
            DO $$
            BEGIN
                IF EXISTS (SELECT 1 FROM information_schema.columns
                           WHERE table_name='price_cards' AND column_name='is_orderable') THEN
                    UPDATE price_cards SET orderable_buy = is_orderable, orderable_sell = is_orderable
                    WHERE is_orderable = true;
                    ALTER TABLE price_cards DROP COLUMN is_orderable;
                END IF;
            END $$;
        """))
        conn.commit()


def _patch_amount_type_enum():
    """
    AmountTypeEnum gained a 'count' value (coin orders). Postgres native
    enum types are NOT altered by create_all() when a Python enum gains
    a new member - the type must be extended explicitly, exactly once
    (ADD VALUE ... IF NOT EXISTS makes this safe to run every startup).
    Without this, any coin order attempt fails with an
    "invalid input value for enum" database error.
    """
    from sqlalchemy import text
    with engine.connect() as conn:
        conn.execute(text("ALTER TYPE amounttypeenum ADD VALUE IF NOT EXISTS 'count'"))
        conn.commit()


def init_db():
    """Call once at app startup: creates the database, then the tables."""
    ensure_database_exists()

    # Import models here so they're registered on Base before create_all runs
    from app import models_db  # noqa: F401

    Base.metadata.create_all(bind=engine)
    _patch_admin_users_table()
    _patch_users_table()
    _patch_orders_table()
    _patch_roles_table()
    _patch_balance_transactions_table()
    _patch_price_cards_table()
    _patch_amount_type_enum()
    print("[db] Tables ready")


def get_db():
    """FastAPI dependency - yields a session, closes it after the request."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()