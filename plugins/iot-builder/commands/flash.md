---
description: Build and safely upload a configured PlatformIO environment
argument-hint: "[environment]"
---

Follow the `flash-board` skill. Treat the optional argument only as a PlatformIO
environment name and verify it against `platformio.ini`. Build first, then ask
for explicit confirmation after presenting the exact environment, board, port,
device metadata, and upload command. Do not perform raw flashing or erasure.
