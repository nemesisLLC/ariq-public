# ARIQ frontend design and implementation

**Initial visual direction rejected by the owner.** The broad rollout is paused. Follow `ATLAS_RESET.md` and `FRONTEND_RESUME.md` for the active atlas-only scope; preserve this file as history, not the current art direction.

Approved brief: full frontend on ariq-unified at dc29137. Branch: frontend-atelier. Preserve app/entrance byte-for-byte; no deployment or paid AI. No scientific engine rewrite.

## Direction

An atlas table, with Uzbekistan as the object on it. The memorable element is the sculpted geography and the water running through it. Controls read as the instruments around a physical scientific model.

Palette: paper #f1ebde, limestone #ded4bd, sapphire #173e50, river #367e85, brass #a08048, ink #203335. Existing locally licensed Cormorant for country titles, places and important quantities; existing Onest for controls and prose. Never use decorative all-caps labels or arbitrary metrics.

Desktop: slim masthead, a compact left-aligned atlas introduction, country occupying the center, small navigational instruments on the right, layer drawer at bottom left. Farm workspace replaces the introduction with a contextual right sheet. Water Futures and Passport are expanded work surfaces with an actual geographic outline, not generic grids of cards. Mobile: two-row masthead, terrain above a short bottom sheet, horizontal tool navigation. Important controls at least 44 px.

```
ARIQ   Atlas / Your farm                         Language · Units
Uzbekistan                               [Places] [Reset] [Find land]
          sculpted relief, geographic water, city miniatures
[Layers]                         controls / selected place
Sources and provenance                     interaction hint
```

Review against brief: ivory and serif are explicitly requested, so keep them; avoid turning that into a generic editorial website by making the geographic object interactive, fitting controls to actual jobs, and using no decorative headline/marketing sections. No giant sidebar, no glass cards, no invented stats. Real elevations determine the relief. Color represents relief styling, never an invented land-cover dataset.

## Interaction decisions

User delegated the farm persistence choice with ease and speed as priorities. One active field, browser persistence, download/import; no accounts or database. Basic inputs field/crop/planting date. Blank inputs remain unknown. Advanced assumptions require deliberate entry. Forecast demand, scenario outputs and lab observations remain distinct. AI stays disabled until owner cap and protections.

Lazy-load field imagery and scientific panels. Keep heavy scenario comparisons off the UI thread with the shared pure season engine; fetch historical weather through the existing endpoint. Aborted/outdated requests must never overwrite a different field. Persist only farm inputs, not claims that stale results are current.

## Verification and resume

Baseline: 141 tests, typecheck and production build pass. Unified working tree initially clean. No source files outside the frontend should change except narrow contract wiring when needed. Final evidence and any Muse follow-ups recorded at delivery.
