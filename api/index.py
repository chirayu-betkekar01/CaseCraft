"""Vercel serverless entrypoint for the FastAPI backend.

`backend/` is a flat module directory — its files import each other by bare name
(`from modeling import ...`), matching `pytest.ini`'s `pythonpath = backend`. We
put that directory on `sys.path`, then load `backend/api.py` **explicitly by file
path** under a distinct module name.

The explicit load matters: Vercel imports this `api/` function directory as a
package named `api`, so a plain `from api import app` can resolve to that empty
package instead of `backend/api.py` and the function crashes on cold start.

All routing is in `vercel.json`: `/api/*` is rewritten here, everything else is
served as the static frontend build. Same origin, so no CORS layer.
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
