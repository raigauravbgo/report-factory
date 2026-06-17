import logging
import time

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from core.config import settings
from core.database import Base, engine
from core.logging_config import setup_logging

setup_logging()
logger = logging.getLogger(__name__)
from api.routes import upload as upload_router
from api.routes import interview as interview_router
from api.routes import kpis as kpis_router
from api.routes import reports as reports_router
from api.routes import dashboard as dashboard_router
from api.routes import session as session_router
from api.routes import log as log_router
from api.routes import templates as templates_router
from db.database import init_db

# Import all models so SQLAlchemy registers them before create_all
import models.dataset  # noqa
import models.upload  # noqa
import models.staging_table  # noqa
import models.processed_table  # noqa
import models.report_recipe  # noqa
import models.kpi_definition  # noqa
import models.dashboard_config  # noqa
import models.custom_kpi_proposal  # noqa
import models.report_template  # noqa

app = FastAPI(
    title="BGO Report Factory",
    version="1.0.0",
    docs_url="/docs" if settings.app_env != "production" else None,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def log_requests(request: Request, call_next):
    start = time.perf_counter()
    response = await call_next(request)
    duration_ms = (time.perf_counter() - start) * 1000
    logger.info(
        "HTTP %s %s → %d  (%.0fms)",
        request.method,
        request.url.path,
        response.status_code,
        duration_ms,
    )
    return response

# Run Alembic migrations (adds new columns to existing tables).
# create_all() only creates missing tables; migrations handle ALTER TABLE.
def _run_migrations() -> None:
    from alembic.config import Config
    from alembic import command
    import os

    cfg = Config(os.path.join(os.path.dirname(__file__), "alembic.ini"))
    cfg.set_main_option("script_location", os.path.join(os.path.dirname(__file__), "migrations"))
    try:
        command.upgrade(cfg, "head")
        logger.info("MIGRATIONS_OK alembic upgrade head completed")
    except Exception as exc:
        logger.warning("MIGRATIONS_SKIP alembic upgrade skipped: %s", exc)


_run_migrations()

# Fallback: also ensure any brand-new tables get created
Base.metadata.create_all(bind=engine)

# Ensure PRD3 schema tables exist on startup (idempotent)
init_db()

# Seed KPI catalog so AI interview can reference KPIs
from seed_catalog import seed as seed_kpi_catalog
seed_kpi_catalog()
logger.info("STARTUP BGO Report Factory v1.0 ready — env=%s", settings.app_env)

app.include_router(upload_router.router)
app.include_router(interview_router.router)
app.include_router(kpis_router.router)
app.include_router(reports_router.router)
app.include_router(dashboard_router.router)
app.include_router(session_router.router)
app.include_router(log_router.router)
app.include_router(templates_router.router)


@app.get("/health")
def health():
    return {"status": "ok", "app": "BGO Report Factory"}
