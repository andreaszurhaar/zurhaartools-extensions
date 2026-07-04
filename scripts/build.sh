#!/usr/bin/env bash
# Build script for Zurhaar Tools extensions
# Usage: ./scripts/build.sh <extension-name|all>
#
# Replaces the shared/ symlink with real files, zips the extension,
# then restores the symlink. Output goes to dist/<extension-name>.zip

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIST_DIR="$REPO_ROOT/dist"

build_extension() {
  local ext="$1"
  local ext_dir="$REPO_ROOT/$ext"

  if [ ! -d "$ext_dir" ]; then
    echo "Error: extension directory '$ext' not found" >&2
    exit 1
  fi

  if [ ! -f "$ext_dir/manifest.json" ]; then
    echo "Error: no manifest.json in '$ext' — not a valid extension" >&2
    exit 1
  fi

  echo "Building $ext..."

  # Remove symlink, copy real shared files in
  if [ -L "$ext_dir/shared" ]; then
    rm "$ext_dir/shared"
    cp -R "$REPO_ROOT/shared" "$ext_dir/shared"
  elif [ ! -d "$ext_dir/shared" ]; then
    cp -R "$REPO_ROOT/shared" "$ext_dir/shared"
  fi

  # Create dist directory
  mkdir -p "$DIST_DIR"

  # Zip the extension (exclude dotfiles, PRODUCT.md, product-image.html, tests/)
  (cd "$ext_dir" && zip -r "$DIST_DIR/$ext.zip" . -x ".*" "PRODUCT.md" "product-image.html" "tests/*")

  # Restore symlink
  rm -rf "$ext_dir/shared"
  ln -s ../shared "$ext_dir/shared"

  echo "Built: dist/$ext.zip"
}

# Parse arguments
if [ $# -eq 0 ]; then
  echo "Usage: $0 <extension-name|all>" >&2
  exit 1
fi

target="$1"

if [ "$target" = "all" ]; then
  # Build all extensions (directories with a manifest.json)
  found=0
  for dir in "$REPO_ROOT"/*/; do
    dir_name="$(basename "$dir")"
    if [ -f "$dir/manifest.json" ]; then
      build_extension "$dir_name"
      found=1
    fi
  done
  if [ "$found" -eq 0 ]; then
    echo "No extensions found" >&2
    exit 1
  fi
else
  build_extension "$target"
fi

echo "Done."
