# Gists Client — Raycast Extension

Search, open, and create gists straight from Raycast. It shells out to the
[`gist` CLI](../../README.md#命令行工具-gist), which reads the **same local SQLite
database** as the desktop app — no separate auth, no API token in Raycast.

## Commands

| Command | Description |
|---------|-------------|
| **Search Gists** | Type to full-text search (`tag:` `lang:` `is:` supported). `↵` opens in browser, `⌘C` copies content, `⌘.` copies the URL. |
| **Create Gist from Clipboard** | Turns the current clipboard text into a new gist; copies the URL on success. |

## Prerequisites

1. Build the `gist` CLI (see the root README):
   ```bash
   cargo build --release --features cli --bin gist
   cp src-tauri/target/release/gist /usr/local/bin/
   ```
2. (Optional) Log in via the desktop app so new gists push to GitHub. Without a
   token, `Create Gist` saves a local draft instead.

## Install (development)

```bash
cd extensions/raycast
npm install
npm run dev      # ray develop — appears in Raycast immediately
```

To build a distributable bundle: `npm run build`.

## Configuration

If `gist` isn't on the default path, set **gist CLI path** in the extension
preferences (Raycast → Extensions → Gists Client). The extension also
auto-probes `/opt/homebrew/bin`, `/usr/local/bin`, and `~/.cargo/bin`.
