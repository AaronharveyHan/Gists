#!/bin/bash
# Alfred Script Filter for Gists Client.
#
# Paste this as the script of a "Script Filter" object (Language: /bin/bash,
# "with input as {query}"). It calls the `gist` CLI and converts its JSON into
# Alfred's item format via the companion to_alfred.py.
#
# Optional workflow variable:
#   gist_bin  — absolute path to the gist binary (default: auto-detect)

set -o pipefail

# Resolve the gist binary.
GIST="${gist_bin:-}"
if [ -z "$GIST" ] || [ ! -x "$GIST" ]; then
  for c in /opt/homebrew/bin/gist /usr/local/bin/gist "$HOME/.cargo/bin/gist"; do
    if [ -x "$c" ]; then GIST="$c"; break; fi
  done
fi
[ -z "$GIST" ] && GIST="$(command -v gist)"

DIR="$(cd "$(dirname "$0")" && pwd)"
query="$*"

if [ -z "$query" ]; then
  "$GIST" list --json -n 30 2>/dev/null | python3 "$DIR/to_alfred.py"
else
  "$GIST" search "$query" --json 2>/dev/null | python3 "$DIR/to_alfred.py"
fi
