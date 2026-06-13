from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from core.config import settings
from api.routes import upload as upload_router
from api.routes import interview as interview_router
from api.routes import kpis as kpis_router
from api.routes import reports as reports_router
from api.routes import validate as validate_router
from api.routes import data_model as data_model_router
from api.routes import kpi_suggestions as kpi_suggestions_router
from api.routes import dimensions as dimensions_router
from api.routes import dashboard as dashboard_router
from db.database import init_db

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

# Ensure PRD3 schema tables exist on startup (idempotent)
init_db()

app.include_router(upload_router.router)
app.include_router(interview_router.router)
app.include_router(kpis_router.router)
app.include_router(reports_router.router)
app.include_router(validate_router.router)
app.include_router(data_model_router.router)
app.include_router(kpi_suggestions_router.router)
app.include_router(dimensions_router.router)
app.include_router(dashboard_router.router)


@app.get("/health")
def health():
    return {"status": "ok", "app": "BGO Report Factory"}
