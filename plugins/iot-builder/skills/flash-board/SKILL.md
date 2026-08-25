---
name: flash-board
description: Build a firmware image and flash it to a connected board. Use when the user asks to flash, upload, or burn firmware to an ESP32, RP2040, STM32 or Arduino, or mentions esptool, picotool, dfu-util or openocd.
---

# Flash a board

Work from what is actually connected, never from what the project claims.

## 1. Find the board

```bash
ls /dev/ttyUSB* /dev/ttyACM* 2>/dev/null
```

No device means nothing to flash. Say so and stop — do not guess a port.

## 2. Identify it before erasing anything

```bash
esptool.py --port <PORT> chip_id
```

The chip you read is the chip you flash. If it disagrees with the project's
target, say so and wait: flashing an ESP32-S3 image to an ESP32-C3 bricks the
boot sequence until someone recovers it over serial.

## 3. Build

Use the project's own build, not a generic one:

- `platformio run` when `platformio.ini` exists
- `idf.py build` when `CMakeLists.txt` names `esp-idf`
- `make` when the Makefile has a `flash` target

## 4. Flash

```bash
esptool.py --port <PORT> --baud 460800 write_flash 0x0 <IMAGE>
```

Report the address map you wrote and the bytes written. A flash that reports
nothing is a flash nobody can verify.

## 5. Prove it took

Read the boot log for one reset cycle:

```bash
timeout 10 cat <PORT>
```

Quote the first lines back. "Flashed successfully" without a boot log is a
claim, not a result.
