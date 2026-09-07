"""Vercel serverless entrypoint for the FastAPI backend.

`backend/` is a flat module directory — its files import each other by bare name
(`from modeling import ...`), matching `pytest.ini`'s `pythonpath = backend`. So
before importing the app we put that directory on `sys.path`; then Vercel's
Python runtime picks up the module-level ASGI `app` and serves it.

All routing is handled in `vercel.json`: `/api/*` is rewritten here, everything
else is served as the static frontend build. Same origin, so no CORS layer.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))

from api import app  # noqa: E402  (import must follow the sys.path insert)

__all__ = ["app"]
