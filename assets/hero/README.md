# Hero imagery slot

Currently **empty**. The home page falls back to a generative paper-architecture
scene built in CSS (`.scene` in `assets/css/style.css`). Drop real renders here
and the page switches to them.

## What to put here

Surreal "paper architecture": sculptural folded paper arches, sheets as
stairways, floating pages in soft light. Warm and dusty, lit from the upper
left, so it sits in the palette (bone `#F2EDE6` / plaster `#E4D6CC` / shadow
lilac `#C8C2D8`).

Compose with the **lower left kept open and bright** — the headline and CTA sit
there, and the type is ink `#1A181E`.

## Files expected

```
hero-1280.avif   hero-1280.webp
hero-1920.avif   hero-1920.webp
hero-2560.avif   hero-2560.webp
```

Budget: **≤300KB for the 1920 AVIF** (the 1x case). Anything heavier will cost
the Lighthouse performance score, which currently sits at 98.

## How to switch over

In `index.html`, uncomment the `<div class="hero-media">` block in the hero
(the `<picture>` with the srcset is already written out), then delete or leave
the `<div class="scene">` block beneath it — the image sits above the scene, so
leaving it does no harm beyond a little dead CSS.

Then add the preload to `<head>`:

```html
<link rel="preload" as="image" type="image/avif"
      href="/assets/hero/hero-1920.avif" fetchpriority="high">
```

Everything else — scrims, parallax, the load sequence — already targets
`.hero-media` and needs no change.
