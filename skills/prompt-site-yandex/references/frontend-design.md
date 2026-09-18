# Frontend design direction for generated sites

Design is the product. Choose one clear, bold, intentional aesthetic direction that fits the client idea, and execute it with precision. Never ship a generic template look.

## Direction
- Commit to an explicit aesthetic direction suited to the client (editorial/magazine, warm artisanal, refined luxury, brutalist, retro-futuristic, organic, soft pastel, industrial) and carry it through every section.
- Avoid generic AI aesthetics: identity fonts like Inter/Roboto/Arial/system-ui, timid evenly-spread palettes, purple gradients on white, uniform equal card grids, decorative gradients without purpose.
- Ground the direction in the subject's real materials, audience and visual language. Name one memorable motif that could not be reused unchanged for an unrelated client.
- Before coding, write a compact design plan: 4–6 named colors with hex values, type roles, layout concept, hero idea, motion idea and a list of defaults to avoid. Critique the plan once and replace anything that still feels interchangeable with another generated landing page.

## Typography
- Pair a distinctive display font with a refined body font (Google Fonts link is acceptable); set tight tracking on large headings, generous line-height for body text.
- Build a clear type scale; let one or two sizes dominate the hierarchy.
- Keep body lines comfortably readable and use typography as part of the composition. Avoid the generated-page habit of styling one arbitrary headline word in a different color or italic without a subject-specific reason.

## Color and theme
- Define the palette as CSS variables; commit to a dominant color with sharp accents rather than timid variety.
- Match the mood requested in the idea; keep text contrast accessible.

## Layout and space
- Prefer asymmetric or unexpected composition, generous negative space or controlled density; vary section rhythm instead of repeating identical blocks.
- No horizontal overflow at 390px or 1440px; touch targets and reading measure stay comfortable on mobile.

## Motion and detail
- Prefer CSS-only motion: one orchestrated, subject-appropriate moment plus useful interaction feedback. Do not apply the same fade-and-slide reveal to every section or hover movement to every card.
- Create depth with layered backgrounds: soft gradient meshes, subtle grain or geometric patterns, intentional borders and shadows.
- All animation respects prefers-reduced-motion.

## Visual acceptance
- A hero image that exists must occupy a stable visible area at both 390px and 1440px; use aspect-ratio, min-height or a responsive explicit height.
- Use the separately generated raster photographs for the hero, catalog and story. Do not replace subject photography with abstract SVG shapes, line drawings or generic geometric placeholders.
- Loading failure shows a visible explanation and recovery action rather than an empty page.
- Demo sites show a persistent, clearly readable demonstration label wherever fictional contacts, prices, reviews or forms appear.
- Keyboard focus is visible. Empty states explain what will appear and what the visitor can do next.
