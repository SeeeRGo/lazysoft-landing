# Frontend design direction for generated sites

Design is the product. Choose one clear, bold, intentional aesthetic direction that fits the client idea, and execute it with precision. Never ship a generic template look.

## Direction
- Commit to an explicit aesthetic direction suited to the client (editorial/magazine, warm artisanal, refined luxury, brutalist, retro-futuristic, organic, soft pastel, industrial) and carry it through every section.
- Avoid generic AI aesthetics: identity fonts like Inter/Roboto/Arial/system-ui, timid evenly-spread palettes, purple gradients on white, uniform equal card grids, decorative gradients without purpose.

## Typography
- Pair a distinctive display font with a refined body font (Google Fonts link is acceptable); set tight tracking on large headings, generous line-height for body text.
- Build a clear type scale; let one or two sizes dominate the hierarchy.

## Color and theme
- Define the palette as CSS variables; commit to a dominant color with sharp accents rather than timid variety.
- Match the mood requested in the idea; keep text contrast accessible.

## Layout and space
- Prefer asymmetric or unexpected composition, generous negative space or controlled density; vary section rhythm instead of repeating identical blocks.
- No horizontal overflow at 390px or 1440px; touch targets and reading measure stay comfortable on mobile.

## Motion and detail
- Prefer CSS-only motion: one orchestrated page-load entrance with staggered animation-delay, subtle hover and focus transitions.
- Create depth with layered backgrounds: soft gradient meshes, subtle grain or geometric patterns, intentional borders and shadows.
- All animation respects prefers-reduced-motion.
