"""Console entry point shared by installed packages and the portable release."""
import asyncio
import sys

from . import server


def main():
    run(server, 'co-op')


def world_main():
    from . import world_server
    run(world_server, 'community')


def run(module, label):
    if sys.platform == 'win32':
        try:
            sys.stdout.reconfigure(encoding='utf-8')
        except (AttributeError, ValueError):
            pass
    try:
        asyncio.run(module.main())
    except KeyboardInterrupt:
        pass
    except OSError as error:
        module.say(f'Could not open {label} server: {error}', 'is the port in use?')
        raise SystemExit(1) from error
