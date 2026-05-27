from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from app.api import upload, mapping, analysis, export

app = FastAPI(title="Executive Dashboard", version="1.0.0")

app.include_router(upload.router, prefix="/api")
app.include_router(mapping.router, prefix="/api")
app.include_router(analysis.router, prefix="/api")
app.include_router(export.router, prefix="/api")

app.mount("/static", StaticFiles(directory="frontend"), name="static")


@app.get("/")
def root():
    return FileResponse("frontend/index.html")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="localhost", port=8000, reload=True)

