from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from app import air_traffic, routes

app = FastAPI(title="Breez")
app.mount("/static", StaticFiles(directory=Path(__file__).parent / "app" / "static"), name="static")
app.include_router(routes.router)
app.include_router(air_traffic.router)
