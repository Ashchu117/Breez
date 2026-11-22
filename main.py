from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from app import address_search, air_traffic, concierge, routes

app = FastAPI(title="Breez")
app.mount("/static", StaticFiles(directory=Path(__file__).parent / "app" / "static"), name="static")
app.include_router(routes.router)
app.include_router(air_traffic.router)
app.include_router(address_search.router)
app.include_router(concierge.router)
