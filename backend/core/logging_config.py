"""
Centralised logging setup for BGO Report Factory.

Call setup_logging() once at app startup (main.py).
All other modules just use: logger = logging.getLogger(__name__)

Log output:
  - Console  : always, respects LOG_LEVEL
  - File     : logs/app.log, rotating 5 MB × 5 backups
"""
import logging
import logging.handlers
import os
from pathlib import Path


def setup_logging() -> None:
    log_level_name = os.getenv("LOG_LEVEL", "INFO").upper()
    log_level = getattr(logging, log_level_name, logging.INFO)

    fmt = logging.Formatter(
        fmt="%(asctime)s | %(levelname)-7s | %(name)-20s | %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )

    # ── Console handler ───────────────────────────────────────────────────────
    console = logging.StreamHandler()
    console.setLevel(log_level)
    console.setFormatter(fmt)

    # ── Rotating file handler → logs/app.log ─────────────────────────────────
    log_dir = Path(__file__).parent.parent / "logs"
    log_dir.mkdir(exist_ok=True)
    file_handler = logging.handlers.RotatingFileHandler(
        log_dir / "app.log",
        maxBytes=5 * 1024 * 1024,  # 5 MB
        backupCount=5,
        encoding="utf-8",
    )
    file_handler.setLevel(log_level)
    file_handler.setFormatter(fmt)

    # ── Root logger ───────────────────────────────────────────────────────────
    root = logging.getLogger()
    root.setLevel(log_level)
    # Remove any existing handlers uvicorn may have added
    root.handlers.clear()
    root.addHandler(console)
    root.addHandler(file_handler)

    # Quiet noisy third-party loggers — suppresses "setup/plugin" startup noise
    for noisy in (
        "httpx", "httpcore", "openai", "anthropic", "google", "sqlalchemy.engine",
        "alembic",          # migration "Running upgrade …" lines
        "uvicorn",          # "Started server process", "Waiting for application startup"
        "uvicorn.error",
        "uvicorn.access",   # per-request access log (we have our own middleware)
        "multipart",
        "passlib",
        "watchfiles",
    ):
        logging.getLogger(noisy).setLevel(logging.WARNING)
