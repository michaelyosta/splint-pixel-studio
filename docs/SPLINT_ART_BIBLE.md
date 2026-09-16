# Splint Art Bible

Version: 1.0
Status: production content run
Scope: 320 original coloring pages and 48 collection/album covers

## Creative direction

Splint is a calm, tactile coloring library whose primary catalog asset is a finished full-color artwork: visually rich, enchanting, atmospheric, contemporary, and desirable before interaction. The artwork should make a user want to color it. It may move between cozy, botanical, whimsical, gothic-romantic, celestial, geometric, kawaii, vintage, and seasonal moods while remaining readable and colorable at thumbnail size.

All subjects, characters, props, rooms, creatures, and compositions are original. Prompts must describe a general concept rather than a named franchise, trademark, living artist, or recognizable copyrighted character.

## Master and delivery formats

The editorial master uses one of these aspect ratios:

- Portrait: 1600×2000 (4:5), for people, fashion, creatures, and tall interiors.
- Square: 1600×1600 (1:1), for centered kawaii scenes, mandalas, and compact still lifes.
- Landscape: 2000×1500 (4:3), for city views, environments, tablescapes, and wide rooms.
- Cover: 1200×1200 (1:1), for collection and album covers.

Keep the important silhouette and all key props within a 5–7% clear breathing space inside the composition. This is not a canvas border: the artwork background must run full-bleed to the image edges, with no artificial white frame or inset panel. The optimized web asset may be resized or converted, but it must preserve the master composition and remain readable on a mobile thumbnail.

The runtime catalog representation is a bounded coloring grid derived from the master. It must remain within the server's supported grid limits and retain the master aspect ratio. Masters belong to the content pipeline/object storage; the runtime bundle contains only the optimized web asset and the bounded grid data required by the coloring engine.

## Full-color artwork and atmosphere

- The primary asset is a finished full-color illustration, not a black-and-white printable coloring page.
- Use sophisticated, coherent palettes with a focal color, harmonious secondary colors, controlled contrast, and visible color-temperature variation.
- Use expressive mood lighting where it serves the scene: golden hour, warm lamps, candlelight, moonlight, neon reflections, rainy-window reflections, luminous plants, stars, fireplace glow, winter window light, colored city lights, dawn, or dramatic sunset.
- Backgrounds are full-bleed. Do not add a white outer border, white frame, inset mat, or decorative edge treatment.
- The runtime interaction map is derived from the full-color master; it is not a replacement for the primary artwork.

## Line art and bounded interaction contours

- Clean dark contours with consistent visual weight where they define tappable regions.
- Closed, fillable regions wherever a region is meant to be colored; the contour contract applies to the derived interaction map and to deliberate boundaries visible in the artwork.
- No monochrome-only output, gray wash, muddy flat palette, photographic textures, text, letters, watermark, signature, logo, or pseudo-text.
- Avoid hairline fragments, accidental dark blobs, noisy hatching, and decorative marks that cannot be filled digitally.
- Use a stronger outer silhouette and slightly lighter interior detail only when the distinction remains unambiguous after optimization.

## Flood-fill region contract

These are production assets for a mobile tap-to-fill application, not printable adult coloring-book plates. Every intended colorable area must be a deliberate closed shape bounded by a continuous, opaque, solid-black line. The boundary must remain closed after the master is downsampled to the runtime grid; nearly touching lines, one-pixel gaps, and open sketch marks are defects.

- Prefer large and medium tappable regions with clear separation.
- Simple pages target approximately 15–35 useful regions; medium pages 25–60; detailed pages generally stay below 80.
- Do not add a decorative line unless it contributes to a meaningful closed region.
- No hatching, cross-hatching, sketch lines, texture strokes, wood grain, fur strokes, fabric-fold strokes, dense leaf-vein networks, or micro-patterns.
- Do not subdivide walls, blankets, cups, furniture, sky, windows, clothing, or animal bodies with arbitrary interior marks.
- Avoid clusters of tiny raindrops, dots, scales, petals, bricks, hairs, or repetitive micro-elements.
- No narrow slivers or islands that are difficult to tap on a phone.
- Verify that the line network creates closed components rather than relying on implied edges.

## Composition

Every page needs one clear focal subject, a supporting environment, and a readable foreground/midground/background hierarchy. Leave breathing room around the focal silhouette. Do not crop hands, paws, faces, furniture, wheels, or the ends of important props. Use asymmetry when it improves the story, but do not let the focal object touch the frame.

The center of interest should survive a square-ish catalog thumbnail. Landscape scenes need a strong horizontal anchor; portrait scenes need a vertical rhythm; square scenes need a stable centered or radial read.

## Difficulty contract

Each 10-page album has exactly 3 simple, 4 medium, and 3 detailed pages.

### Simple

Large colorable areas, few secondary objects, a strong silhouette, and no fragile micro-details. The page should be comfortable for a short session and for a small phone display.

### Medium

A clear focal subject plus several supporting objects or environmental layers. Use moderate internal detail, varied shapes, and enough open regions to reward a longer session.

### Detailed

Rich environment, repeated motifs, and interesting small elements, while retaining closed regions and clear hierarchy. Detail must be intentional rather than noisy; do not turn the page into an unfillable texture.

## Anatomy and character rules

Human figures use believable proportions, readable joints, natural poses, and simplified but complete hands. Count fingers only when hands are prominent; never allow fused or floating fingers. Faces get two eyes, a coherent nose/mouth treatment, and a readable expression. Avoid uncanny duplicate facial features.

Animals and fantasy creatures must have a stable body axis, plausible limb attachment, consistent paws/hooves/wings, and a recognizable head-to-body relationship. Cute styling may simplify anatomy but may not create extra limbs, mirrored eyes, or impossible joints.

## Objects and environments

Furniture, cups, books, plants, windows, bicycles, tools, clothing, and food need coherent perspective and visible boundaries. Repeated motifs should vary in scale or orientation. Interiors should have a floor/wall relationship and a deliberate light source implied by shape arrangement, without rendering gradients or shadows. Nature scenes should separate foreground, subject, and background with line hierarchy rather than shading.

## Digital coloring suitability

The page must have enough enclosed regions for fill-based interaction. Do not rely on open sketch marks to define a region. Avoid vast blank areas unless they are an intentional simple background. Avoid thousands of one-pixel islands after grid conversion. The content pipeline must record dimensions, palette/grid metadata, a preview path, and a region-count QA result; a page is not PASS if it only exists as a master but cannot be opened by the product.

## Covers

Covers are 1200×1200 square finished full-color editorial illustrations without text. They may be denser and more atmospheric than a coloring page, but keep clean contours, deliberate bounded shapes, full-bleed backgrounds, and no artificial outer frame. The UI overlays collection or album names. Do not draw logos, badges, lettering, or branded marks into a cover.

## Originality and prompt hygiene

Use concrete scene nouns and composition rather than references to a franchise or a named creator. Before generation, compare the content registry's semantic signature, subject, setting, action, and focal object against every existing entry. A changed cup, color, or adjective is not a new work. Regenerate or reject anything that is compositionally indistinguishable from another entry.

## ImageGen negative constraints

Every page prompt includes: no monochrome-only output, no grayscale-only output, no muddy beige palette, no random rainbow palette, no photographic textures, no text, no letters, no watermark, no signature, no logo, no trademark, no copyrighted character, no franchise reference, no named artist imitation, no cropped focal objects, no extra limbs, no malformed hands/paws, no pseudo-text, no artificial white border or frame, and no filled black background.

## QA gate

Each generated page receives `PASS`, `REGENERATE`, or `REJECT`.

PASS requires: original scene; correct orientation and internal breathing space around key subjects; finished full-color artwork with full-bleed background and no external frame; coherent anatomy and perspective; closed colorable regions in the interaction map; appropriate difficulty; readable thumbnail; valid optimized asset; valid runtime metadata; no semantic duplicate.

REGENERATE is used when the concept is sound but a localized defect can be corrected with a targeted new generation. REJECT is used when the image is unusable, non-original, or cannot be safely repaired. Neither status counts toward the 320 final pages. Replacement pages keep a new stable ID and are recorded in the registry.

## Measurement

The current product vocabulary is content-first: `collection_open`, `album_open`, `coloring_open`, `coloring_start`, `coloring_complete`, `premium_content_open`, `premium_sample_open`, and `store_open_from_content`. Payloads contain stable content IDs and bounded metadata only; no source images, bot data, payment secrets, or unnecessary personal data.
