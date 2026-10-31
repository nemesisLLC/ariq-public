# Farmer flow and map review — 31 October 2026

Repository: `nemesisLLC/ariq-public`, local `main` based on `5888936`.
The owner authorized publishing these changes to the public repository and
the existing Cloudflare site on 31 October 2026.

## Requested direction

Make the app understandable for a farmer: one clear next step, less visible
text, a useful Copilot throughout the workflow, and no Registan entrance on
mobile. Fix the flat map's missing water segments and flickering.

Keep the existing stack, datasets, and scientific calculations. Use existing
paper (`#f2f0e8`), ink (`#173f49`), river (`#177e91`), vegetation (`#70896c`),
and earth (`#ad8c62`) colors and local Onest/Cormorant fonts. Primary actions
come first; research, provenance and detailed science use disclosures.

## Implemented

- Skip the entrance and replay on small screens or touch-first devices,
  including landscape phones. Do not load entrance images on these devices.
- Repair corrupted atlas text, including Uzbek/Russian language choices.
- Move secondary atlas research choices into Explore.
- Put field search before the example, shorten instructions and the example
  banner, and show estimated water need before the daily/scientific breakdown.
- Add local, translated Copilot guidance for location, drawing, crop choice,
  loading, failure, results and season exploration. Local navigation works
  without the model. Preserve the privacy explanation in a disclosure.
- Keep Copilot mounted between atlas and farm views so requests and draft text
  survive navigation. Clamp stored window positions, add Escape/focus recovery,
  prevent duplicate sends, and show pending work. Improve touch input sizing.
- Respect the farm's current units and cap conversation history to the server's
  accepted length. Give demand cards plain labels and converted display units.
- Ask the model for brief, practical, farmer-facing answers with one next step,
  without weakening the existing tool or scientific validation rules.
- Load all pages of waterways, including streams and drains. Cancel obsolete
  requests, discard late responses, retain the last good overlay on failure,
  fetch a margin beyond the viewport, and retain source-line detail.

## Verification

- `npm run verify`: typecheck, **223 tests**, and production build passed.
- Cloudflare typecheck, tests, production build and deployment dry run passed.
  The dry run required the normal user's filesystem access on Windows.
- `scripts/frontend-smoke.mjs` exercises the production server on port 3011:
  portrait/landscape phones and desktop, mobile entrance asset bypass, local
  guidance, long replies during navigation, window recovery, keyboard focus,
  field error/retry, result disclosures, units/history, and unavailable AI.
- Inspected desktop and phone screenshots, including empty/help, drawing,
  crop, error and result states. The browser run reported no page exceptions.
- Regression test compares the paginated overlay with the complete existing
  water inventory. It preserves every waterway and water-body feature.
- AI and weather in browser checks are mocked. No paid model calls were made.
  Satellite imagery was also checked with network access enabled.

Run the browser check after `npm run build` and `npm run start -- --port 3011`:
`node --experimental-strip-types scripts/frontend-smoke.mjs`.
Its screenshots default to `../frontend-review/` outside the repository.

## Limits and next action

The mapped water inventory itself remains incomplete and uses simplified
centerlines/point locations. These fixes recover omitted existing features;
they do not reconstruct missing waterways or shoreline polygons from imagery.
The Blue lines disclosure explains this without adding a permanent paragraph.

Actual Muse response quality still needs an owner-approved, budgeted live
evaluation. Mocked browser checks verify interaction and failure behavior,
not the quality of live model answers. This was a focused frontend pass,
not a complete repository security audit.

Release target: public repository `main` and the existing `ariq-private` Worker.
Keep existing secrets, budget storage, bindings and runtime settings. Verify the
deployed mobile flow and local guidance without sending paid model requests.
Next.js generated the root AGENTS.md during local development; it contains the
version-specific documentation instruction.
