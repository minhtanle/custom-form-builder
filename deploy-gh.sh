#!/usr/bin/env bash
# deploy-gh.sh — build dist/ rồi push toàn bộ file lên nhánh gh-pages (GitHub Pages)
# Cách dùng: ./deploy-gh.sh        (cần git + Node v22+)
set -euo pipefail
cd "$(dirname "$0")"

REMOTE="custom-form-builder"
BRANCH="gh-pages"

# --- 1) Đảm bảo Node v22+ (Laragon để node v20 đầu PATH) ---
have_node22() { node -v 2>/dev/null | grep -qE '^v(2[2-9]|[3-9][0-9])'; }
if ! have_node22; then
  for d in /c/laragon/bin/nodejs/node-v2[23].*-win-x64; do
    [ -d "$d" ] && export PATH="$d:$PATH" && break
  done
  have_node22 || { echo "ERROR: cần Node v22+ để build."; exit 1; }
fi
echo "[1/4] Node: $(node -v)"

# --- 2) Build engine + builder ---
echo "[2/4] Build..."
npm run build            # -> dist/custom-dynamic-form.js
npm run build:builder    # -> dist/builder/

# --- 3) Copy dist/ sang branch gh-pages qua worktree tạm ---
echo "[3/4] Tạo branch $BRANCH..."
git worktree prune 2>/dev/null || true
if git show-ref --verify --quiet "refs/heads/$BRANCH"; then
  git branch -D "$BRANCH"
fi
TMP="$(mktemp -d)"
cleanup() { git worktree remove --force "$TMP" 2>/dev/null || true; rm -rf "$TMP"; }
trap cleanup EXIT
git worktree add -b "$BRANCH" "$TMP"

(cd "$TMP" && git rm -rf -q .)
cp -r dist/. "$TMP/"

# --- 4) Commit + push ---
cd "$TMP"
git add -A
git -c user.name="GitHub Pages Deploy" \
    -c user.email="noreply@github.com" \
    commit -m "Deploy to GitHub Pages ($(date -u +%Y-%m-%dT%H%M%SZ))"
echo "[4/4] Push..."
git push -u "$REMOTE" "$BRANCH:$BRANCH" --force-with-lease
echo "Xong! Nhớ bật Settings > Pages > Branch = gh-pages / root"