# Mino

Mino is a local browser for self-contained HTML apps. Point it at a directory to browse, search, and preview its `.html` and `.htm` files.

## Install

Requires Go 1.24.4 or later.

```sh
go install ./cmd/mino
```

## Usage

```sh
mino [dir] [--port N]
```

The directory defaults to the current working directory. `--port` overrides the configured port for the current run; use `0` to select an available port automatically. Mino prints the local URL and runs until interrupted with Ctrl+C.

On first use, Mino creates `<dir>/.mino/config.toml`:

```toml
name = "my-apps"
port = 0
host = "127.0.0.1"
ignore = ["archive/**"]
```

- `name`: workspace name shown in the UI
- `port`: listening port; `0` asks the OS for a free port
- `host`: listening address
- `ignore`: additional root-relative glob patterns to exclude

## Limitations and security

Mino is intended for local use and binds to `127.0.0.1` by default. Do not change `host` to a public or LAN address unless you understand the exposure: Mino has no authentication.

Only self-contained, single-file HTML apps are supported. Companion CSS, JavaScript, images, and other neighboring files are not served.
