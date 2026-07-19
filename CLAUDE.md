# CLAUDE.md

## Read SITE_SPEC.md first

Before changing anything in this repository, read [SITE_SPEC.md](SITE_SPEC.md).
It is the source of truth for this site: the page inventory, the navigation,
the CTA hierarchy rule, the copy voice rules, and a copy deck holding every
approved user-facing string verbatim.

**You may not change approved copy or navigation without listing every change
explicitly at the top of your summary to the user.** If you think a string or a
nav item should change, propose it and get agreement first. When a change is
agreed, update SITE_SPEC.md in the same commit as the change, so the file never
drifts from the shipped site.

## The rules most often broken

These are written out in full in SITE_SPEC.md. The short version:

- **No em-dashes in user-facing text.** Not one. Use a full stop or a comma.
- **No mirrored two-part slogans.** Say the thing once, plainly.
- **One primary call to action per viewport height.** Nothing else at primary weight.
- **One top bar, four items, always visible.** No overlay menu, no hamburger.
  Blog and Changelog live in the footer only.
- **A visitor must never click expecting a web tool and find a download
  requirement after scrolling.** Desktop tool pages say so in their first line.
- **No looping animation and no scroll parallax.** A previous build measured
  7fps because of a 20s loop on the hero planes. SITE_SPEC.md has the numbers.
- **No invented figures**, testimonials, review scores, awards, or user counts.

## Working on this site

Static HTML and CSS. No build step, no framework, no bundler. Serve it with any
static file server to preview:

```
python -m http.server 8000
```

Pushing to `master` deploys to `https://benchpdf.pages.dev` via Cloudflare
Pages, so verify before you push.

## Quality gates

Any change must still pass the gates listed at the end of SITE_SPEC.md:
Lighthouse performance ≥90 and accessibility/SEO ≥95 on every page type, zero
em-dashes, every nav and footer link landing where labelled at 1440px and
1024px, a real conversion completing from the home page drop zone, and the
browser/desktop expectation rule holding on all ten tool pages.
