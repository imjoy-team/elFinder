"""Set up file for imjoy-elfinder."""
import json
from pathlib import Path

from setuptools import setup, find_packages

PROJECT_DIR = Path(__file__).parent.resolve()
PACKAGE_JSON = json.loads((PROJECT_DIR / "package.json").read_text())


setup(
    name="imjoy-elfinder",
    version=PACKAGE_JSON["version"],
    description="ImJoy elFinder",
    url="https://github.com/imjoy-team/elFinder/",
    author="imjoy-team",
    author_email="imjoy.team@gmail.com",
    license="BSD-3",
    packages=find_packages(include=["imjoy_elfinder", "imjoy_elfinder.*"]),
    include_package_data=True,
    zip_safe=False,
)
