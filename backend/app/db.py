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


def init_db():
    """Call once at app startup: creates the database, then the tables."""
    ensure_database_exists()

    # Import models here so they're registered on Base before create_all runs
    from app import models_db  # noqa: F401

    Base.metadata.create_all(bind=engine)
    print("[db] Tables ready")


def get_db():
    """FastAPI dependency - yields a session, closes it after the request."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()