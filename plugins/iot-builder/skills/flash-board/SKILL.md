---
name: flash-board
description: Build and safely upload an existing PlatformIO project to an explicitly selected serial device. Use when platformio.ini exists and the user asks to build, flash, or upload its configured environment.
allowed-tools: [Bash, Read, Grep]
---

# Build and upload a PlatformIO project

This skill supports only projects with an existing `platformio.ini`. PlatformIO
owns the board definition, image layout, uploader, and upload protocol. Never
replace it with raw `esptool`, `picotool`, `dfu-util`, `openocd`, filesystem
copying, or writes to a guessed address.

## Safety boundary

- Never install tools or packages automatically, and never use `npx`.
- Never expose, list recursively, mount, or grant an MCP server access to
  `/dev` or another device directory.
- Never accept an arbitrary path as a serial port. Select an exact port from
  PlatformIO's current device inventory and pass it as one quoted argument.
- Never erase or upload until the user confirms the final target after a
  successful build.
- Never guess an environment, board, port, image, address, or recovery action.
- Do not kill another process to free a port. Ask the user to close its serial
  monitor or other owner.

## 1. Inspect the project and tool

```bash
command -v pio
test -f platformio.ini
```

If either check fails, stop. Tell the user PlatformIO must be installed through
their preferred method, or that the project is outside this plugin's scope.
Do not fall back to a different uploader.

Inspect `platformio.ini` before executing it. Surface `extra_scripts`, a custom
`upload_command`, custom package or platform URLs, and other executable hooks.
These are project code and may run during build or upload. If their origin is
not trusted, stop and ask the user before running PlatformIO.

Read the resolved configuration without editing it:

```bash
pio project config --json-output
```

Choose only an environment listed by that output. If the user did not name one
and there is not exactly one unambiguous default, ask which environment to use.
Treat the environment name as data and pass it as one quoted argument. For this
minimal plugin, reject names outside `^[A-Za-z0-9_.-]+$` rather than placing
untrusted shell syntax in a command.

## 2. Build before touching a device

For a build-only request, no connected board is required. Run:

```bash
pio run -e '<environment>'
```

If the build fails, report the failure and stop. Do not upload stale output or
retry with a lower-level tool. Record the configured `platform`, `board`, and
`framework` from the resolved environment for the final review.

## 3. Select the connected device

```bash
pio device list --json-output
```

Use only an exact port present in this fresh output. If a configured port is no
longer present, stop. If several devices are present and the correct one is not
unambiguous, show their port, description, and hardware ID and ask the user to
choose. Do not infer identity from port ordering.

On POSIX, resolve the selected path and verify it is a character device without
traversing its parent directory. Its resolved path must remain the same serial
device represented by PlatformIO. On Windows, accept only the exact `COM` port
returned by PlatformIO. Reject control characters, whitespace tricks, shell
metacharacters, or a path that PlatformIO did not return.

If the selected port is busy, stop and ask the user to close its current owner.
Do not terminate processes automatically.

## 4. Confirm, then upload

After the successful build and immediately before upload, show:

- project path;
- environment, platform, board, and framework;
- exact port, device description, and hardware ID;
- the exact command below.

Ask for explicit confirmation of that target. A prior request to "flash" is
not confirmation of a device that had not yet been identified. After the user
confirms, run exactly:

```bash
pio run -e '<environment>' -t upload --upload-port '<port>'
```

Pass the environment and port as separate, quoted arguments. Do not append
user-provided flags or execute a custom recovery/erase command. Allow the
upload command to complete; do not start a concurrent monitor or second
uploader.

## 5. Report the result

Report PlatformIO's exit status and its board, environment, port, image-size,
and verification summary when present. A successful upload is not proof that
the firmware boots correctly. Serial monitoring and automatic reset recovery
are outside this minimal plugin; say so rather than using `cat`, opening `/dev`
broadly, or improvising another command.
