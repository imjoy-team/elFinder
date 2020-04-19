import json
from pathlib import Path

__all__ = ["__version__", "get_base_dir", "get_js_path", "get_html_path"]

BASE_DIR = Path(__file__).parent.resolve()
PACKAGE_JSON = json.loads((BASE_DIR / "package.json").read_text())
__version__ = PACKAGE_JSON["version"]


def get_base_dir():
    return str(BASE_DIR)


def get_js_path(full=False):
    if full:
        return str(BASE_DIR / "js" / "elfinder.full.js")
    else:
        return str(BASE_DIR / "js" / "elfinder.min.js")


def get_html_path():
    return str(BASE_DIR / "elfinder.html")
