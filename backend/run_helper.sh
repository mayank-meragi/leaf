#!/bin/sh
# Starts the Leaf helper with the first Python (3.9+) on this machine whose HTTPS works.
#
# Plain `python3` is often the wrong one: a pyenv build missing its OpenSSL, for example, imports fine but can't make
# a single HTTPS request. Set LEAF_PYTHON=/path/to/python to choose one yourself.
cd "$(dirname "$0")" || exit 1

for candidate in $LEAF_PYTHON python3.13 python3.12 python3.11 python3.10 python3.9 python3 python; do
  py=$(command -v "$candidate" 2>/dev/null) || continue
  if "$py" -c 'import ssl, sys; ssl.create_default_context(); sys.exit(0 if sys.version_info >= (3, 9) else 1)' 2>/dev/null; then
    echo "Using $py ($("$py" -c 'import sys; print(sys.version.split()[0])'))"
    exec "$py" -m leaf_backend.serve "$@"
  fi
done

echo "No usable Python found. The helper needs Python 3.9+ with working HTTPS (the ssl module)." >&2
echo "Install one (for example: brew install python) or set LEAF_PYTHON=/path/to/python." >&2
exit 1
