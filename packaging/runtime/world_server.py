"""Portable community-server entry point; implementation lives in the package."""
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / 'server'))
os.environ.setdefault('BLACKSOULS_VR_WORLD_DIR', str(ROOT))

from blacksouls_vr_coop.cli import world_main  # noqa: E402

if __name__ == '__main__':
    world_main()
