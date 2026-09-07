"""Vercel serverless entrypoint for the FastAPI backend.

The filename is a catch-all route (`[...path].py`), so Vercel sends every
`/api/*` request straight to this function with the original path intact — no
`vercel.json` rewrite, which matters because Vercel now forwards the *rewritten*
path to backend functions. FastAPI's own `/api/...` routes then match normally.
Everything that is not `/api/*` is served as the static frontend build
(`frontend/dist`). Same origin, so no CORS layer.

`backend/` is a flat module directory — its files import each other by bare name
(`from modeling import ...`), matching `pytest.ini`'s `pythonpath = backend`. We
put that directory on `sys.path`, then load `backend/api.py` **explicitly by file
path** under a distinct module name so it can't collide with this `api/` package.
"""

import importlib.util
import sys
from pathlib import Path

_BACKEND = Path(__file__).resolve().parent.parent / "backend"
sys.path.insert(0, str(_BACKEND))

_spec = importlib.util.spec_from_file_location("casecraft_backend_api", _BACKEND / "api.py")
_module = importlib.util.module_from_spec(_spec)
sys.modules[_spec.name] = _module
_spec.loader.exec_module(_module)

app = _module.app

__all__ = ["app"]
