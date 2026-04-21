#!/bin/bash

# Package Click Custodian for distribution
# This script creates a clean ZIP file ready for Chrome Web Store

set -e

# Always run from the project root, regardless of where the script was invoked.
PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_ROOT"

echo "📦 Packaging Click Custodian..."

# Check if icons exist
if [ ! -f "icons/icon16.png" ] || [ ! -f "icons/icon48.png" ] || [ ! -f "icons/icon128.png" ]; then
    echo "⚠️  Warning: Icon files not found in icons/ directory."
    echo ""
    read -p "Continue anyway? (y/N) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

# Create temp directory
TEMP_DIR=$(mktemp -d)
echo "📁 Creating temporary directory: $TEMP_DIR"

# Copy files to temp directory
cp -r . "$TEMP_DIR/"

# Remove unnecessary files
echo "🧹 Cleaning up unnecessary files..."
cd "$TEMP_DIR"

rm -rf .git .gitignore .DS_Store
rm -rf .claude .mcp.json
rm -f package.json package-lock.json
rm -f playwright.config.js jest.config.js
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

# Create ZIP into the project root, sourced from the cleaned temp tree.
ZIP_NAME="click-custodian-v$(grep '"version"' manifest.json | sed 's/.*: "\(.*\)".*/\1/').zip"
echo "📦 Creating $ZIP_NAME..."

zip -r "$PROJECT_ROOT/$ZIP_NAME" . -x "*.DS_Store" -x "__MACOSX/*"

# Clean up
cd "$PROJECT_ROOT"
rm -rf "$TEMP_DIR"

echo "✅ Package created: $ZIP_NAME"
echo ""
echo "📋 Next steps:"
echo "   1. Test the extension by loading the unpacked directory"
echo "   2. Upload $ZIP_NAME to Chrome Web Store"
echo "   3. Fill in store listing details"
echo ""
echo "🎉 Done!"
