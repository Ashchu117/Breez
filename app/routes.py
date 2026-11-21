from pathlib import Path

from fastapi import APIRouter
from fastapi.responses import FileResponse, HTMLResponse

router = APIRouter()
HOME_PAGE = Path(__file__).parent / "pages" / "home.html"


@router.get("/", response_class=HTMLResponse, include_in_schema=False)
def home() -> FileResponse:
    return FileResponse(HOME_PAGE, media_type="text/html")


@router.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
