# BenchPDF marketing site

A static marketing site for BenchPDF (the Windows desktop PDF conversion/editing
app). Plain HTML/CSS, the same "Ink & Paper" design tokens and IBM Plex fonts as
the app itself, zero third-party requests, zero analytics.

## Structure

```
index.html          Home: screenshot-led pitch, download CTA, feature list, privacy blurb
privacy.html         Plain-English privacy page
changelog.html        Release history
tools/*.html          One page per conversion (10 pages)
assets/css/style.css   Design tokens + layout (ported from the app's style.css)
assets/fonts/          Vendored IBM Plex woff2 subsets (SIL OFL 1.1)
assets/js/theme.js      Light/dark theme toggle (no analytics, no tracking)
assets/img/             Screenshot + favicons
sitemap.xml, robots.txt
favicon.ico
```

No build step. No JavaScript framework. No CDN dependencies — every font,
stylesheet, and script is served from this same origin.

## Before going live — two placeholders to replace

This was built before the GitHub repo and production domain existed, so two
placeholders are used throughout. Find and replace both:

1. **`REPLACE-ME`** — appears in every download button and footer "Source"
   link, as `https://github.com/REPLACE-ME/benchpdf`. Replace with your real
   GitHub owner/repo once it's created (e.g. `github.com/yourname/benchpdf`),
   and once you've cut a release, point the download buttons at
   `.../releases/latest`.
2. **`benchpdf.example`** — the placeholder domain used in every `<link
   rel="canonical">`, `og:url`, `og:image`, and in `sitemap.xml` /
   `robots.txt`. `.example` is the IANA-reserved placeholder TLD, chosen so
   it's obviously not a real address. Replace with your actual Cloudflare
   Pages domain (`*.pages.dev` or a custom domain) before publishing.

A quick way to find every instance of both:

```
grep -rn "REPLACE-ME\|benchpdf.example" .
```

## Local preview

Any static file server works, e.g.:

```
python -m http.server 8420
```

then open `http://127.0.0.1:8420/`.

## Deploying to Cloudflare Pages

1. Push this folder to a GitHub repository (a **separate** repo from the
   BenchPDF app itself — the app repo contains a confidential test fixture
   and must never be made public; this site has no such constraint).
2. In the Cloudflare dashboard: **Workers & Pages → Create → Pages → Connect
   to Git**, pick the repo.
3. Build settings: **no build command, no framework preset** — this is a
   plain static site. Set the output directory to `/` (the repo root).
4. Deploy. Cloudflare Pages serves `index.html` at `/`, and will also serve
   `foo.html` at both `/foo.html` and `/foo` automatically.
5. Once you have the `*.pages.dev` URL (or a custom domain attached), replace
   `benchpdf.example` everywhere as described above and push again.

## Verification performed

- All 13 pages rendered and visually checked (light theme) against the same
  design tokens as the packaged app.
- Lighthouse (performance, accessibility, best-practices, SEO) run against
  every page on a local static server: **all 13 pages scored 99–100 in every
  category** (home page performance: 99, docked only by cache-header
  diagnostics that a locally-run `http.server` doesn't set and that
  Cloudflare Pages sets automatically in production; every other page/category
  is a clean 100).
- No fabricated testimonials, ratings, "trusted by" logos, or download
  counters anywhere on the site.
