from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from app.routes import router

app = FastAPI(title="Breez")
app.mount("/static", StaticFiles(directory=Path(__file__).parent / "app" / "static"), name="static")
app.include_router(router)
