from pathlib import Path

from fastapi import FastAPI
from starlette.exceptions import HTTPException
from starlette.staticfiles import StaticFiles

from app.main import app as api


class FrontendFiles(StaticFiles):
    async def get_response(self, path, scope):
        try:
            return await super().get_response(path, scope)
        except HTTPException as error:
            if error.status_code != 404 or Path(path).suffix:
                raise
            return await super().get_response("index.html", scope)


app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
app.mount("/api", api)
app.mount("/", FrontendFiles(directory=Path(__file__).resolve().parents[1] / "static", html=True))
