# Bundled Fonts

These three variable woff2 files are loaded by `popup.html` and `options.html`
via `fonts.css` (`@font-face` declarations at the extension root). They were
chosen so the extension can declare `data_collection_permissions: required:
["none"]` on AMO and make zero outbound network requests at popup/options open.

The countdown overlay (`content.css`) deliberately falls back to system fonts
and does NOT use these — bundling for that surface would require a
`web_accessible_resources` entry and would inject `@font-face` rules into
every page the user visits. The overlay's existing fallback chain
(`-apple-system`, `BlinkMacSystemFont`, `Segoe UI`, etc.) is good enough.

## Files

| File | Family | Version | Size | SHA-256 |
|---|---|---|---|---|
| `inter-latin-wght-normal.woff2` | Inter Variable | `@fontsource-variable/inter@5.2.8` | 47 KB | `3100e775e8616cd2611beecfa23a4263d7037586789b43f035236a2e6fbd4c62` |
| `fraunces-latin-full-normal.woff2` | Fraunces Variable (full axes: opsz + wght + soft + wonk) | `@fontsource-variable/fraunces@5.2.9` | 118 KB | `7e744849028e2219e2aa1bc467dc4032980dc4487c9c3da3010081cd72d3b103` |
| `jetbrains-mono-latin-wght-normal.woff2` | JetBrains Mono Variable | `@fontsource-variable/jetbrains-mono@5.2.8` | 39 KB | `18be452724bfdc236c074ca94a249a7f41a86752c7d04ab258ce9ed5651f6a7e` |

Total: ~204 KB.

Fontsource auto-syncs from the upstream author repos (rsms/inter,
undercasetype/Fraunces, JetBrains/JetBrainsMono) and ships pre-subsetted
latin woff2 files at immutable per-version jsdelivr URLs.

## Sources

```
https://cdn.jsdelivr.net/npm/@fontsource-variable/inter@5.2.8/files/inter-latin-wght-normal.woff2
https://cdn.jsdelivr.net/npm/@fontsource-variable/fraunces@5.2.9/files/fraunces-latin-full-normal.woff2
https://cdn.jsdelivr.net/npm/@fontsource-variable/jetbrains-mono@5.2.8/files/jetbrains-mono-latin-wght-normal.woff2
```

## Verifying integrity

```bash
shasum -a 256 fonts/*.woff2
```

The output should match the SHA-256 column above.

## When to update

Bundle once, leave alone. Refresh only if:

- A user reports a missing or broken glyph (rare for stable Latin)
- The UI gains characters outside Basic Latin
- A major upstream semver bump (e.g. Inter v5 → v6) lands a behavior change worth picking up

Last checked: 2026-04-20.
