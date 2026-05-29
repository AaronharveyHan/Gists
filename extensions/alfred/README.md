# Gists Client — Alfred Workflow

Search your gists from Alfred and open / copy them. Like the Raycast extension,
it drives the [`gist` CLI](../../README.md#命令行工具-gist), so it reads the same
local database as the desktop app.

> Requires Alfred with the **Powerpack**. Uses `python3` (ships with the Xcode
> Command Line Tools) for the JSON→Alfred transform.

## Prerequisites

```bash
cargo build --release --features cli --bin gist
cp src-tauri/target/release/gist /usr/local/bin/
```

## Build the workflow (one-time, ~2 min)

Alfred workflows can't be checked into git as plain text, so wire it up once:

1. **Alfred Preferences → Workflows → `+` → Blank Workflow.** Name it "Gists Client".
2. Right-click the canvas → **Inputs → Script Filter**.
   - **Keyword:** `gist` (with space, argument *optional*)
   - **Language:** `/bin/bash`
   - **with input as** `{query}`
   - **Script:**
     ```bash
     ./gist-search.sh "{query}"
     ```
3. Click the workflow's **gear → Open in Finder**, then copy `gist-search.sh`
   and `to_alfred.py` from this folder into that workflow directory. Make the
   script executable: `chmod +x gist-search.sh`.
4. Right-click the canvas → **Actions → Open URL**, set URL to `{var:gist_url}`.
   Drag a connection from the Script Filter to it. (This opens the gist in the
   browser on `↵`.)
5. *(Optional)* Add a **Hotkey** trigger and connect it to the Script Filter.

### Optional: custom binary path

If `gist` isn't auto-detected, set a workflow variable `gist_bin` to its
absolute path (workflow **gear → Variables**).

## Usage

`gist <query>` — type to search (`tag:` `lang:` `is:` supported). Empty query
lists recent gists. `↵` opens the selected gist; `⌘C` copies its URL.
