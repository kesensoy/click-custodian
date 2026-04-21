#!/bin/bash

# Package Click Custodian for distribution
# This script creates a clean ZIP file ready for Chrome Web Store

set -e

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
rm -f package.sh package.json package-lock.json
rm -f test-page.html
rm -f playwright.config.js jest.config.js
rm -rf docs/ manual-tests/ tests/ e2e/ node_modules/
# scripts/ holds the screenshot capture pipeline — its HTML files
# still <link> to fonts.googleapis.com for the listing screenshots.
# Strip so the published zip contains zero references to external
# CDNs (the runtime extension uses the bundled fonts/ directory).
rm -rf scripts/

# Create ZIP
ZIP_NAME="click-custodian-v$(grep '"version"' manifest.json | sed 's/.*: "\(.*\)".*/\1/').zip"
cd ..
echo "📦 Creating $ZIP_NAME..."

# Go back to original directory for ZIP creation
cd -
zip -r "../$ZIP_NAME" . -x "*.DS_Store" -x "__MACOSX/*"

# Move ZIP to original directory
mv "../$ZIP_NAME" "$OLDPWD/"

# Clean up
cd "$OLDPWD"
rm -rf "$TEMP_DIR"

echo "✅ Package created: $ZIP_NAME"
echo ""
echo "📋 Next steps:"
echo "   1. Test the extension by loading the unpacked directory"
echo "   2. Upload $ZIP_NAME to Chrome Web Store"
echo "   3. Fill in store listing details"
echo ""
echo "🎉 Done!"
