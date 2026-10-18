"""Compatibility entry point for the upstream launcher and portable release."""
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / 'server'))
os.environ.setdefault('BLACKSOULS_VR_COOP_CONFIG', str(ROOT / 'coop_server.json'))

from blacksouls_vr_coop.cli import main  # noqa: E402

if __name__ == '__main__':
    main()
