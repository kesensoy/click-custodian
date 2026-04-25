#!/usr/bin/env bash
# Regenerates all icon PNGs from the two source SVGs (logo.svg, logo-16.svg).
# Default (navy) keeps the current cornflower stroke; the moss/graphite/ember
# variants substitute the stroke color so chrome.action.setIcon() can swap
# them at runtime when the user has both starred the repo AND chosen a
# non-navy palette.
#
# Stroke colors mirror each palette's dark-mode --cornflower token in
# popup.css / options.css, so the toolbar icon matches the in-popup brand
# mark when palette + star unlock the swap.

set -euo pipefail
cd "$(dirname "$0")/.."

if ! command -v rsvg-convert >/dev/null 2>&1; then
  echo "❌ rsvg-convert not found. Install with: brew install librsvg" >&2
  exit 1
fi

DEFAULT_STROKE="#7CB9E8"

# Pairs of "palette stroke"
PALETTES=(
  "navy     #7CB9E8"
  "moss     #B8D6B1"
  "graphite #E8C468"
  "ember    #E8A87C"
)

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

for entry in "${PALETTES[@]}"; do
  read -r palette stroke <<<"$entry"
  suffix="-${palette}"
  [[ "$palette" == "navy" ]] && suffix=""

  sed "s|stroke=\"${DEFAULT_STROKE}\"|stroke=\"${stroke}\"|" icons/logo.svg    > "$TMP/logo.svg"
  sed "s|stroke=\"${DEFAULT_STROKE}\"|stroke=\"${stroke}\"|" icons/logo-16.svg > "$TMP/logo-16.svg"

  rsvg-convert -w 128 -h 128 "$TMP/logo.svg"    -o "icons/icon128${suffix}.png"
  rsvg-convert -w  48 -h  48 "$TMP/logo.svg"    -o "icons/icon48${suffix}.png"
  rsvg-convert -w  16 -h  16 "$TMP/logo-16.svg" -o "icons/icon16${suffix}.png"
  echo "✓ ${palette} → icon{16,48,128}${suffix}.png"
done

echo "Done."
