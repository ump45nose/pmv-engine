from pathlib import Path

import pytest


@pytest.hookimpl(tryfirst=True)
def pytest_configure(config):
    # Temporary files stay in the repo's git-ignored cache, whatever directory pytest runs from.
    config.option.basetemp = Path(__file__).resolve().parents[2] / ".cache" / "pytest"
