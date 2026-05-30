#!/usr/bin/env python3
"""Convert `gist ... --json` output (read from stdin) into Alfred Script Filter JSON."""
import json
import sys


def main() -> None:
    try:
        gists = json.load(sys.stdin)
    except Exception:
        gists = []

    items = []
    for g in gists:
        files = g.get("files", []) or []
        title = g.get("description") or (files[0] if files else "(untitled)")
        vis = "draft" if g.get("local") else ("public" if g.get("public") else "secret")
        subtitle = vis
        if files:
            subtitle += " · " + ", ".join(files)
        arg = g.get("url") or g.get("id", "")
        items.append({
            "uid": g.get("id", ""),
            "title": title,
            "subtitle": subtitle,
            "arg": arg,
            "valid": True,
            "text": {"copy": arg, "largetype": title},
            "variables": {
                "gist_id": g.get("id", ""),
                "gist_url": g.get("url", ""),
                "is_local": "1" if g.get("local") else "0",
            },
        })

    if not items:
        items.append({
            "title": "No matching gists",
            "subtitle": "Try a different query, or save one with `gist save`",
            "valid": False,
        })

    json.dump({"items": items}, sys.stdout)


if __name__ == "__main__":
    main()
