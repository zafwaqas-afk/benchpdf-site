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

## Live

Deployed at **https://benchpdf-site.pages.dev/** via Cloudflare Pages,
connected to `github.com/zafwaqas-afk/benchpdf-site`.

Both placeholders used during development are resolved:

1. ~~`REPLACE-ME`~~ — every download button and footer "Source" link points
   at the real repo, `https://github.com/zafwaqas-afk/benchpdf`, and download
   buttons target `.../releases/latest` (currently the `v1.0.0` release with
   `BenchPDF-Setup-1.0.0.exe` attached).
2. ~~`benchpdf.example`~~ — every `<link rel="canonical">`, `og:url`,
   `og:image`, `sitemap.xml`, and `robots.txt` now points at
   `benchpdf-site.pages.dev`. If you later attach a custom domain, swap that
   in the same way: `grep -rn "benchpdf-site.pages.dev" .`

## Local preview

Any static file server works, e.g.:

```
python -m http.server 8420
```

then open `http://127.0.0.1:8420/`.

## Deploying to Cloudflare Pages

Already deployed (see "Live" above) — these are the steps that were used,
in case of a redeploy elsewhere:

1. Push this folder to a GitHub repository (a **separate** repo from the
   BenchPDF app itself — the app repo contains a confidential test fixture
   and must never be made public; this site has no such constraint).
2. In the Cloudflare dashboard, click **Create** under Workers & Pages. If it
   defaults into the **Workers** flow (asking for a "Deploy command" like
   `npx wrangler deploy`), look for the **"Looking to deploy Pages? Get
   started"** link and use that instead — it's the simpler, zero-config path
   for a plain static site. (`wrangler.jsonc` in this repo makes the Workers
   path work too, in case that's the only option in your dashboard.)
3. Connect to Git, pick the repo. Build settings: **no build command, no
   framework preset**, output directory `/` (the repo root).
4. Deploy. Cloudflare Pages serves `index.html` at `/`, and will also serve
   `foo.html` at both `/foo.html` and `/foo` automatically.

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
