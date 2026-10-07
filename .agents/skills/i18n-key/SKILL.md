---
name: i18n-key
description: "Add, rename or remove user-facing text in the web apps (web, scheduler, newsletter). Use whenever a component gains a string, a label, an error message or a date/number format."
---

# Add or change UI text

Every user-facing string goes through `t()`; Spanish is the primary locale and both locales keep the same keys.

| App | Files |
|---|---|
| web | `apps/web/src/locales/{es,en}.json`; Apuntes screens use `apuntes.{es,en}.json` (namespace loaded by `src/i18nApuntes.ts`) |
| scheduler | `apps/scheduler/src/locales/{es,en}.json` |
| newsletter | `apps/newsletter/src/locales/{es,en}.json` |

## Steps

1. Reuse an existing key when the meaning is identical (search both files first). Otherwise add a nested key under
   the screen or feature it belongs to, `camelCase` or `snake_case` matching its neighbours.
2. Write the Spanish text first (rioplatense, `vos`, matching the surrounding copy), then the English one. Use the
   domain words from `GLOSSARY.md` (e.g. "comisión"/"commission", "Apuntes" in both).
3. Add the key to **both** files in the same position. Plurals use i18next suffixes (`_one`, `_other`; English
   ordinals may need `_ordinal_one|two|few|other`, Spanish only `_other`). Interpolate with `{{name}}`, never by
   string concatenation.
4. Dates and numbers: `toLocaleDateString(i18n.language === 'es' ? 'es-AR' : 'en-US', …)`. Newsletter dates are
   `YYYY-MM-DD` strings parsed with `src/utils/dates.js`.
5. Removing a string: delete the key from both files once no code references it (search for the key).
6. Verify: `node scripts/checks/locales.mjs` (key parity) and `bun run --filter @ceitba/<app> lint`.

Done when the component renders only `t()` output and both locale files have the same key set.
