# Registan entrance — rescue and finish pass

## Scope and safety

Only the entrance and its handoff are in scope. Work is on `frontend-registan-rescue` in `ariq-registan`, an isolated worktree of the existing ARIQ repository. Baseline `c8f250b` preserves the earlier entrance. No merge, deployment, or remote publication has been performed. The original `ariq` checkout's uncommitted irrigation work remains untouched.

The existing atlas is retained. The earlier baseline added a shared terrain-loading promise for background warm-up; this finish pass does not change geography, farm algorithms, simulations, AI, or API routes.

## Diagnosis grounded in the implementation

- The old camera independently tweened its eye and target. Its reveal keyframe looked at y=11.1 from y=3.8, z=9.8, pushing the central doorway below the frame. There was no continuous route whose composition was checked against the opening.
- Broad surfaces used the same high-contrast ornament everywhere. That made the walls, trims, ceiling and door compete, and revealed repeated texture crops at close range.
- The rescue's conch cells were 0.68 m tall at 0.48 m spacing. Their overlapping faces, combined with a rear wall extending to 14.5 m, interrupted the carved cavities. The side walls also extended into the lowest cells. This was real geometry intersection; camera near/far settings would not fix it.
- Light plaster and floor materials were uniform base colors with generic bump detail. High fill lighting and clean gold highlights flattened the hierarchy.

## Current design and implementation

The user accepted the stronger composition and requested refinement rather than another redesign. Retain the central doorway, nested pointed arch, conch vault and large ivory CTA. Use quiet blue architectural finishes around the ornament, warm mineral plaster in the side bays, and muted stone underfoot. Keep the strongest decoration on the arch, vaulted ceiling and doorway.

- Curved conch contains individually modeled recessed cells, rims and pendant tips. Cell height is now 0.47 m at 0.48 m tier spacing. Upper enclosure is behind the conch; lower structural walls end below it. Upper side/rear infill closes the gaps exposed by removing the intersecting walls.
- Decorative cells use a restrained crop of the gold material rather than unrelated full motifs in every cell. Supporting surfaces use lower-contrast finishes; side bays carry defined mosaic panels instead of continuous pattern.
- `finishes.ts` creates deterministic seamless albedo, normal and roughness maps for mineral plaster, stone and aged metal. Stone slabs have restrained per-piece color and UV variation. Ceramic uses lower saturation, less metalness and finer relief.
- Directional sunlight, reduced hemisphere/bounce fill, environment reflections, contact occlusion and ACES exposure 0.82 give darker shadows without hiding the doorway. No bloom or fake light beams.
- A 5.8-second centripetal spline keeps the camera in the clear aisle. Fade starts after crossing the rear opening. Final courtyard and passage architecture provide a destination. Near/far are 0.06/75 m.
- CTA remains 300 × 70 px with 22 px type on desktop, 280 × 66 px on mobile. Existing Cormorant Garamond wordmark and Onest controls remain. Language choices, skip, reduced motion, session entry and replay are preserved.
- Loading/failure use compressed desktop and portrait captures of the actual scene, with separate live controls. They are explicitly previews, not substituted geometry. No controls are baked into those images.

## Assets and licenses

- All geometry and procedural finish maps are original project code. No downloaded mesh is used.
- `public/media/registan/ceramic.webp` and `gold.webp` are original bitmap materials generated earlier in this task with the built-in image-generation tool, then encoded as WebP. They are not photographic samples from the user's references, not a scan, and are not represented as Creative Commons assets. Creative brief: orthographic blue/ivory/gold ceramic arabesque and warm gold floral painted ornament, no perspective, lettering or baked scene lighting. Exact earlier generation prompt strings were not retained in the repository.
- `preview.webp` and `preview-mobile.webp` are screenshots of the current rendered geometry, compressed locally.
- The user's reference photographs inform proportions, color and ornament; their pixels are not shipped as textures.
- The optional [Registan complex scan](https://sketchfab.com/3d-models/registan-complex-samarkand-uzbekistan-af54f5280eb249beb6501eab4769c351) and [Tilya-Kori prayer hall scan](https://sketchfab.com/3d-models/prayer-hall-tilya-kori-madrasah-samarkand-4310bb0a1f4249e1832afa202f80cc2e) by Global Digital Heritage and GDH-Afrika were investigated but not downloaded/incorporated. Their API listed CC BY-NC 4.0 and roughly 3.0M/2.49M triangles respectively. Download requires login; user authorized proceeding without them. Their license must be reviewed before any future use.
- Existing font licenses remain in `public/fonts/` (SIL OFL files).
- Blender 5.0.1 is installed at `D:/blender.exe`, verified with `--version`. No Blender asset was produced or imported in this pass. No paid services or new package dependencies were added.

## Verification — 2026-10-27

- `npm run typecheck`: passed.
- `npm test`: 111 passed, 0 failed (includes two route/clearance/composition tests, desktop and mobile, sampling 241 positions each). These test aisle dimensions and projection, not a mesh collision engine.
- `npm run build`: passed, including production TypeScript validation and all 18 pages.
- Real browser renders inspected at 1920 × 1080 and 390 × 844. Desktop CTA measured 300 × 70, 22 px text. Uzbek mobile labels checked for fit.
- Opening, initial movement, midpoint and doorway crossing reviewed using development-only timeline pause controls. Full normal playback reached the existing ARIQ application; focus moved to its container.
- Forced WebGL failure retained Enter/Skip and reached the application. Reduced-motion branch bypassed travel; this was a development override, not an OS-setting test. Loading preview checked on desktop and mobile.
- Before/after captures are in `docs/entrance-review/`. Full-resolution working captures are in the ignored `review-captures/` folder.
- No new full animation recording is included in this checkpoint. The user prioritized appearance and before/after stills in the latest request.

## Honest visual limits

This is an original, real-time architectural interpretation, not a measured/photogrammetric reconstruction of Tilya-Kori. The finish pass visibly reduces noise and improves shadow/material definition, but it should not be described as photorealistic or historically exact. No low-end physical phone/GPU performance certification has been performed. The procedural geometry remains editable for further reference-specific modeling.

## Resume/run

`npm run dev -- --port 3107` in this worktree. Preview `http://127.0.0.1:3107/?review=polish` bypasses remembered entry in development. `?reviewTime=1.4`, `3`, or `4.5` pauses after Enter for frame review. `?reviewClean` hides controls for scene-only screenshots. `?reviewLoading`, `?reviewFailure`, and `?reviewReduced` exercise those states. All overrides are development-only.
