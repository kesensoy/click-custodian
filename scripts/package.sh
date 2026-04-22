#!/bin/bash
#
# Package Click Custodian for distribution. Emits three zips:
#   1. click-custodian-chrome-vX.Y.Z.zip   — Chrome Web Store upload
#   2. click-custodian-firefox-vX.Y.Z.zip  — Firefox AMO upload (manifest
#      patched to also declare background.scripts; see Firefox patch
#      section below)
#   3. click-custodian-source-vX.Y.Z.zip   — Source bundle for AMO review.
#      Required when published code differs from source; we ship plain
#      unbuilt source so technically optional, but cheap insurance.

set -e

# Always run from the project root, regardless of where the script was invoked.
PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_ROOT"

VERSION=$(python3 -c 'import json; print(json.load(open("manifest.json"))["version"])')
[[ -n "$VERSION" ]] || { echo "❌ Could not read version from manifest.json"; exit 1; }
echo "📦 Packaging Click Custodian v$VERSION..."

# Clean any prior-run artifacts at PROJECT_ROOT *before* the cp -r so they
# don't get copied into the temp tree (cleaned again from there too, but
# this avoids the round trip and makes the invariant explicit).
find . -maxdepth 1 -name "click-custodian-*.zip" -delete

if [ ! -f "icons/icon16.png" ] || [ ! -f "icons/icon48.png" ] || [ ! -f "icons/icon128.png" ]; then
    echo "⚠️  Warning: Icon files not found in icons/ directory."
    read -p "Continue anyway? (y/N) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

TEMP_DIR=$(mktemp -d)
echo "📁 Staging in: $TEMP_DIR"
cp -r . "$TEMP_DIR/"

cd "$TEMP_DIR"
echo "🧹 Stripping dev-only files..."

# Recursive .DS_Store strip — top-level rm misses nested ones (e.g.
# icons/.DS_Store) that macOS sprinkles around.
find . -name .DS_Store -delete

rm -rf .git .gitignore
rm -rf .claude .mcp.json
rm -f package.json package-lock.json
rm -f playwright.config.js jest.config.js
rm -f my-rules.json
# Docs, license, and reference material that the runtime never reads.
# The store listings carry license metadata and link to PRIVACY.md at
# its raw-GitHub URL, so end users have access — they just don't need
# the file inside the .crx. fonts/OFL.txt is the one exception: OFL §2
# requires the license to travel bundled with the woff2 files.
rm -f CLAUDE.md README.md PRIVACY.md LICENSE
rm -f fonts/README.md
rm -rf docs/ manual-tests/ tests/ e2e/ node_modules/
# Gitignored working dirs that `cp -r .` happily copies — none of
# these belong in a published zip. .screenshot-profile/ in particular
# is an ephemeral Chrome user-data dir from the screenshot pipeline
# and could contain incidental browsing state.
rm -rf .screenshot-profile/ design-explorations/ test-results/
# README/store-listing hero images — never loaded by the runtime.
rm -rf assets/
# scripts/ holds the packager + screenshot capture pipeline. The
# screenshot HTML files still <link> to fonts.googleapis.com for the
# listing shots — strip so the published zip contains zero references
# to external CDNs (the runtime extension uses the bundled fonts/
# directory). package.sh itself also lives here and is dev-only.
rm -rf scripts/
# Build artifacts from prior runs of this script.
rm -f click-custodian-*.zip

CHROME_ZIP="click-custodian-chrome-v$VERSION.zip"
FIREFOX_ZIP="click-custodian-firefox-v$VERSION.zip"
SOURCE_ZIP="click-custodian-source-v$VERSION.zip"

echo "📦 Creating $CHROME_ZIP (Chrome — manifest as-is)..."
zip -rq "$PROJECT_ROOT/$CHROME_ZIP" . -x "*.DS_Store" -x "__MACOSX/*"

# Firefox patch: AMO's static validator rejects MV3 manifests that only
# declare background.service_worker, even though Firefox 128+'s runtime
# accepts it. Adding background.scripts (pointing at the same file)
# satisfies the validator. Chrome would warn about background.scripts
# in MV3 — that's why we keep src manifest Chrome-clean and only patch
# in the temp tree for the Firefox zip.
echo "🦊 Patching manifest for Firefox (adding background.scripts)..."
# debug.js MUST come first in scripts[]: background.js does
# importScripts('debug.js') which is a service-worker global. If Firefox
# ever falls through to the scripts[] code path (e.g. drops service_worker
# support in a future release), the importScripts call would throw
# ReferenceError. Listing debug.js explicitly here means it's already
# loaded as a sibling script before background.js executes.
python3 -c "
import json
with open('manifest.json') as f: m = json.load(f)
sw = m['background']['service_worker']
m['background']['scripts'] = ['debug.js', sw]
with open('manifest.json', 'w') as f: json.dump(m, f, indent=2)
"

echo "📦 Creating $FIREFOX_ZIP (Firefox — dual background keys)..."
zip -rq "$PROJECT_ROOT/$FIREFOX_ZIP" . -x "*.DS_Store" -x "__MACOSX/*"

cd "$PROJECT_ROOT"
rm -rf "$TEMP_DIR"

# Source zip: only the files git tracks, so gitignored junk and local
# work like my-rules.json never make it in.
echo "📦 Creating $SOURCE_ZIP (source for AMO review)..."
rm -f "$SOURCE_ZIP"
git ls-files | zip -q -@ "$SOURCE_ZIP"

echo ""
echo "✅ Done. Three zips at project root:"
ls -lh click-custodian-chrome-v$VERSION.zip click-custodian-firefox-v$VERSION.zip click-custodian-source-v$VERSION.zip | awk '{print "   "$NF, "("$5")"}'
echo ""
echo "📋 Next steps:"
echo "   • Chrome Web Store: upload $CHROME_ZIP"
echo "   • Firefox AMO:      upload $FIREFOX_ZIP (+ $SOURCE_ZIP if asked)"
