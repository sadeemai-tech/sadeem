---
name: Web quality
description: Ship web pages that pass Core Web Vitals, a11y, and responsive checks.
---
# Web quality

## Performance
- Images: explicit width/height (no CLS), lazy-load below the fold, modern formats
  (webp/avif) with fallback.
- Ship no blocking third-party scripts in the head; defer/analytics last.
- LCP target < 2.5s: preload the hero asset, inline critical CSS, font-display: swap.

## Accessibility
- Every interactive element is a real element (button/a/input) with a visible
  :focus-visible state; keyboard order matches visual order.
- Color contrast ≥ 4.5:1 for body text; never encode meaning in color alone.
- Label every input; aria-* only when semantics cannot express the behavior.

## Responsive + semantics
- Mobile-first breakpoints; test 360px and 1440px before declaring done.
- One h1 per page; landmarks (header/nav/main/footer) instead of div soup.
- Verify with Lighthouse mobile + keyboard-only pass + zoom to 200%.
