# Launcher Extensions

Search, open, and create gists from macOS launchers. Both extensions drive the
[`gist` CLI](../README.md#命令行工具-gist), which reads the **same local SQLite
database** as the desktop app — so there's no separate login or API token.

```
Raycast / Alfred  ──►  gist --json  ──►  shared SQLite  ◄──  desktop app
```

| Extension | Folder | Notes |
|-----------|--------|-------|
| **Raycast** | [`raycast/`](raycast/) | Full TypeScript extension. `npm install && npm run dev`. |
| **Alfred** | [`alfred/`](alfred/) | Script Filter + `to_alfred.py`; wire into a workflow (see its README). Needs the Powerpack. |

## Shared prerequisite — the `gist` CLI

```bash
cargo build --release --features cli --bin gist
cp src-tauri/target/release/gist /usr/local/bin/
```

Both extensions auto-detect `gist` in `/opt/homebrew/bin`, `/usr/local/bin`, and
`~/.cargo/bin`, and let you override the path.
