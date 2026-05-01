#!/bin/bash
# Usage: ./meld-compare.sh <branch> <file-path>
# Compares the given branch version of a file against your working tree version in Meld.

set -e

if [ -z "$1" ] || [ -z "$2" ]; then
  echo "Usage: $0 <branch> <file-path>"
  exit 1
fi

BRANCH="$1"
FILE="$2"

if [ ! -f "$FILE" ]; then
  echo "Error: '$FILE' not found in working tree"
  exit 1
fi

if ! git show "$BRANCH:$FILE" > /dev/null 2>&1; then
  echo "Error: '$FILE' not found in branch '$BRANCH'"
  exit 1
fi

TMPDIR=$(mktemp -d)
TMPFILE="$TMPDIR/$(basename "$FILE")"
git show "$BRANCH:$FILE" > "$TMPFILE"

echo "Opening Meld: $BRANCH (left) vs working tree (right)"
meld "$TMPFILE" "$FILE"

rm -rf "$TMPDIR"