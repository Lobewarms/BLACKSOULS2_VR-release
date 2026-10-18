"""Console entry point shared by installed packages and the portable release."""
import asyncio
import sys

from . import server


def main():
    if sys.platform == 'win32':
        try:
            sys.stdout.reconfigure(encoding='utf-8')
        except (AttributeError, ValueError):
            pass
    try:
        asyncio.run(server.main())
    except KeyboardInterrupt:
        pass
    except OSError as error:
        server.say(f'Could not open co-op server: {error}', 'is the port in use?')
        raise SystemExit(1) from error
