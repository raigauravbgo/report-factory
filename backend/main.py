from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from core.config import settings
from core.database import Base, engine
from api.routes import upload as upload_router
from api.routes import interview as interview_router
from api.routes import kpis as kpis_router
from api.routes import reports as reports_router
from api.routes import dashboard as dashboard_router
from db.database import init_db

# Import all models so SQLAlchemy registers them before create_all
import models.dataset  # noqa
import models.upload  # noqa
import models.staging_table  # noqa
import models.processed_table  # noqa
import models.report_recipe  # noqa
import models.kpi_definition  # noqa
import models.dashboard_config  # noqa

app = FastAPI(
    title="BGO Report Factory",
    version="1.0.0",
    docs_url="/docs" if settings.app_env != "production" else None,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Create SQLAlchemy tables (upload/interview routes)
Base.metadata.create_all(bind=engine)

# Ensure PRD3 schema tables exist on startup (idempotent)
init_db()

# Seed KPI catalog so AI interview can reference KPIs
from seed_catalog import seed as seed_kpi_catalog
seed_kpi_catalog()

app.include_router(upload_router.router)
app.include_router(interview_router.router)
app.include_router(kpis_router.router)
app.include_router(reports_router.router)
app.include_router(dashboard_router.router)


@app.get("/health")
def health():
    return {"status": "ok", "app": "BGO Report Factory"}
