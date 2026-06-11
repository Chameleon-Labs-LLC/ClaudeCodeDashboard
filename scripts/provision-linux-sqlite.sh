#!/usr/bin/env bash
# Provision a Linux build of better-sqlite3 into .native/linux-<arch>/ WITHOUT
# touching node_modules (whose compiled binary belongs to the Windows side —
# this repo is shared between PowerShell and WSL on /mnt/d).
#
# lib/db.ts side-loads the result via better-sqlite3's `nativeBinding` option.
# Re-run after upgrading Node (ABI change) or better-sqlite3 itself.
set -euo pipefail
cd "$(dirname "$0")/.."

VERSION=$(node -p "require('better-sqlite3/package.json').version")
ABI=$(node -p "process.versions.modules")
ARCH=$(node -p "process.arch")
DEST=".native/linux-${ARCH}"
URL="https://github.com/WiseLibs/better-sqlite3/releases/download/v${VERSION}/better-sqlite3-v${VERSION}-node-v${ABI}-linux-${ARCH}.tar.gz"

mkdir -p "$DEST"

echo "better-sqlite3 v${VERSION}, node ABI ${ABI}, ${ARCH}"
if curl -fsSL "$URL" 2>/dev/null | tar -xz -C "$DEST" --strip-components=2 build/Release/better_sqlite3.node; then
  echo "Installed official prebuild -> $DEST/better_sqlite3.node"
else
  echo "No prebuild for this version/ABI; compiling from source (needs g++, make, python3)..."
  BUILD_DIR=$(mktemp -d)
  trap 'rm -rf "$BUILD_DIR"' EXIT
  cp -r node_modules/better-sqlite3 "$BUILD_DIR/pkg"
  rm -rf "$BUILD_DIR/pkg/build"
  (cd "$BUILD_DIR/pkg" && npx node-gyp rebuild --release)
  cp "$BUILD_DIR/pkg/build/Release/better_sqlite3.node" "$DEST/better_sqlite3.node"
  echo "Compiled from source -> $DEST/better_sqlite3.node"
fi

node -e "
const Database = require('better-sqlite3');
const db = new Database(':memory:', { nativeBinding: '$DEST/better_sqlite3.node' });
db.exec('CREATE TABLE t(x)');
console.log('verified: linux better_sqlite3.node loads OK');
db.close();
"
