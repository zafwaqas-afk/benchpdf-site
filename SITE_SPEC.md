# SITE_SPEC.md

**This file is the source of truth for the BenchPDF marketing site.**

Any session touching this site must read this file before making changes. You
may not change approved copy or navigation without listing every change
explicitly at the top of your summary to the user. If you believe a string or a
nav item should change, say so and get agreement first, then update this file in
the same commit as the change.

Last verified against the shipped site: 2026-07-20.

**Identity: Machined Grid (YZY), applied 2026-07-20.** Dark-first machined
steel over an engineering grid; light mode is concrete titanium. IBM Plex Sans
and Plex Mono only; the serif is retired and no italic exists in the UI. No
rounded corner exists anywhere; structural borders are 2px. Two accents only:
the wordmark `pdf` span (tangerine `#F37021` dark, hot pink `#D6116A` light,
crossfading on theme switch) and the Download block (near-black `#0E1012` with
lime `#8AE000` mono text, identical in both themes). Lime, tangerine and pink
appear nowhere else. Theme switch fades colours at 280ms; reduced motion gets
an instant swap.

**The bench glyph (added 2026-07-21).** The wordmark carries a small workbench
with a bench vice, drawn as technical line art in the manner of a parts-catalog
illustration: benchtop, two legs, one stretcher, vice block with handle stub at
the top right. It is an inline 19x14 SVG (`.wm-glyph`, `stroke="currentColor"`,
1.3px strokes, square caps, `aria-hidden`) sitting baseline-aligned to the left
of `benchpdf` in every header and footer wordmark. It inherits ink in both
themes and never takes an accent colour or a container. The favicon set
(`favicon.ico` 16+32, `favicon-32.png`, `apple-touch-icon.png`, `icon-512.png`)
derives from the same geometry as solid ink bars on the dark ground `#131519`;
the 16px sizes drop the stretcher. Regeneration script: the glyph geometry is
the source of truth in the header SVG markup.

**Uniform voice (2026-07-21):** every page speaks the home page's instrument
language. Page titles and prose section headings are mono caps labels (titles
~15-20px at .16em tracking, section headings 12px at .26em, muted), never
display type. On the home page the hero fills
the first viewport (the drop zone absorbs spare height) and the footer sits
immediately after it, revealed by one small scroll; there is no bare ground
between hero and footer or after the footer. Short inner pages pin the
footer to the viewport bottom.

## 0b. Design tokens

| Token | Dark (default) | Light `[data-theme="light"]` |
|---|---|---|
| ground | `#131519` | `#CDD1D2` |
| nav | `#16181D` | `#D4D8D9` |
| tile | `#171A1F` | `#D2D5D6` |
| panel | `#1B1E23` | `#D9DCDD` |
| hairline | `#3E454C` | `#9AA1A5` |
| border-strong | `#4A5158` | `#878E93` |
| ink (text) | `#E6E9EC` | `#191C1E` |
| muted | `#8A96A2` | `#4F565C` |
| faint | `#5A6472` | `#6E767C` |
| ghost (hero question) | `#5F6873` | `#8A9298` |
| grid minor / major | `#1C2A22` / `#26402F` | `#B7CFBC` / `#9FC0A9` (green stays on in light) |
| tick | `#2FBF6B` at 25% | same |
| brand (wordmark pdf) | `#F37021` | `#D6116A` |
| download block / text | `#0E1012` / `#8AE000` | same |
| ok / err / warn | `#4CAF7D` / `#E06A56` / `#D09A3E` | `#226245` / `#963524` / `#6F4D14` |

All pairs verified >= 4.5:1 (text) or >= 3:1 (logotype span) on 2026-07-20.
The ghost question line is aria-hidden decoration and deliberately sits below
the contrast floor; the real page h1 is visually hidden beside it. The grid is
painted on the fixed `.gridlayer` element behind the content on every page,
never as a body background (Chrome/Windows stale-paint bug); the hero carries at most
two crosshair ticks (`.grid-ticks`, aria-hidden).

---

## 0. Positioning

**The three pillars are simplicity, functionality and trust. None of those three
words, nor their synonyms, may appear anywhere in the copy.** Each is
demonstrated instead:

| Pillar | How it is demonstrated, never claimed |
|---|---|
| Simplicity | A working drop zone in the first viewport. No sign-up wall, no options to read before starting. |
| Functionality | Copy leads with what the output preserves, in specifics a reader can check against their own file. |
| Trust | A dated release line in every footer, a version number on the download button, one stated limitation on every tool page, and honest screenshots only. |

**The lead is conversion quality.** The proposition is that your document comes
out the way it went in. Not that the tool is easy, fast, or safe.

### Banned words

These must not appear in any user-facing string. Verified with:

```
grep -rniE "(simple|powerful|trust|secure|private|forever|unlimited|no limits|no signup)" --include=*.html . | grep -v privacy.html
```

`private` is exempt on `/privacy` only, where it is the subject of the page.
Also banned as marketing phrases anywhere: `free forever`, `no watermarks`,
`no account`. The word `watermark` is allowed where a blog post explains what
actually happens to one during a conversion.

### Pricing honesty

The exact string `Free during early access` appears in **exactly two places**
and nowhere else:

1. Directly under the hero drop zone on `/`.
2. Next to the download button on `/download`.

The home page no longer carries a desktop pitch block, so the second placement
moved to `/download` when that block was removed.

There is a third occurrence in the home page source, on the desktop-only
interstitial. It is not a third placement: the interstitial replaces the drop
zone and its badge hides the hero line (`[data-state="desktop"]` in
`style.css`), so a visitor never sees two pricing lines at once. Any grep of
the markup will return three hits on two pages; that is expected and correct.
Four would not be.

There is no pricing page and none is to be invented. Desktop tool pages carry a
requirement note under their download button (`Needs Microsoft Word installed.`
and so on) with no pricing claim.

### Structural trust

- The download button reads `Download BenchPDF 1.0.2 for Windows`. The version
  number is part of the string and is updated on each release.
- Every page footer carries the dated latest-release line, linking to
  `/changelog`.
- Every tool page carries exactly one honest limitation, under a `Where it
  stops` heading, before the how-to.
- No testimonials, star ratings, user counts, download counters, awards, or
  security certifications. None have been supplied and none are to be invented.

---

## 0a. A converter must be in the fidelity suite to be linked

**No conversion may be linked from this site unless it is a registered engine in
`tests/engines.py` in the app repo and its column reads GREEN in
`tests/fidelity_suite.py`.**

This is not a style rule. On 2026-07-19 a browser PDF to PowerPoint converter was
live on the home page for weeks. It produced 242 fragmented text boxes on a
9-page report the desktop engine renders as 38, zero native tables where the
source had 17, no background layer at all, and every font collapsed to Arial. It
was never in the suite, so nothing caught it.

The suite now runs the same fixtures and the same assertions against every
registered engine, with per-engine columns:

```
python tests/fidelity_suite.py                      # every engine
python tests/fidelity_suite.py --engines=python     # one engine
```

An engine marked `ships = True` that fails any invariant exits non-zero and
blocks the release. An engine marked `ships = False` is reported loudly but does
not block, because it is not linked from anywhere.

### Currently linked conversions

| Conversion | Where | Engine | Suite |
|---|---|---|---|
| PDF to Images | browser | pdf.js canvas render | covered, GREEN |
| PDF to Text | browser | pdf.js text content | covered, GREEN, byte-comparable to desktop |
| Images to PDF | browser | pdf-lib | covered, GREEN |
| PDF to PowerPoint | browser AND desktop | ported JS engine / python | covered, GREEN in BOTH engine columns |
| Word/Excel/PowerPoint to PDF, PDF to Word | desktop only | Office automation | covered by verify_outputs.py |
| Edit PDF text | desktop only | python | covered, GREEN |

**History:** the first browser PDF to PowerPoint converter was withdrawn on
2026-07-19 after failing 18 suite checks. The pipeline was then ported properly
(assets/js/engine/) and relinked on 2026-07-20 once its suite column read GREEN
alongside the python engine: 131/131 checks, plus a golden render comparison
through PowerPoint itself. The engine lazy-loads on first conversion (2.6 MB,
mostly the pdf.js worker); page load fetches none of it. The one documented
parity gap: the browser maps fonts to metric-compatible equivalents from a
fixed table, because it cannot see the fonts installed on the visitor's PC.
On 2026-07-21 the per-page image fallback became region-level: when extraction
geometry is untrustworthy the engine bounds the suspect elements and preserves
only those regions as image, keeping every clean span and table editable; a
whole page ships as image only when the suspect regions cover more than 40% of
its content area (report note: "1 region on page 1 preserved as image"). Font
substitution never triggers fallback, because a metric-compatible substitute is
still editable text. The same change fixed the statement class that used to
lose whole pages to the fallback: pdf.js reports NaN metrics for Type3 fonts
and the NaN poisoned every span bbox on the page
(tests/js_engine/region_fallback_verify.py holds the class to 90%+ editable
characters).
On 2026-07-21 an owner-verified render comparison of a real bank statement
found five faults the suite had never asserted on: text painted as glyph-
outline paths with an invisible Type3 text layer ghost-doubled between the
background raster and the editable layer; an unruled transaction ledger
shipped as loose text boxes; a decorative 8-square mark became an empty 1x8
native table; short header blocks wrapped mid-word; and every run colour
flattened to #000000. All five are fixed in both engines and the statement
fixture plus five new suite invariants now make each of them a red build.

### The corpus gate

The suite's fixtures are synthetic, and synthetic fixtures only contain the
failures someone already imagined. `tests/corpus/` therefore holds TWO scored
corpora, run with the same render-diff metric (PowerPoint render of the
output vs render of the source PDF, SSIM per page):

* `docs/` - 90 deterministic synthetic documents across six classes;
* `real/docs/` - ~46 PUBLIC real-world PDFs across nine generator classes
  (LaTeX, government form pipelines, InDesign report streams, troff, Word),
  rebuilt from the URLs in `real/manifest.json`. No downloaded binary is
  ever committed.

```
python tests/corpus/corpus_run.py            # both corpora + triage
```

**Gate rule: a release may not reduce the synthetic median, the real-corpus
median, or the worst-page floor (the lowest single page score across both
corpora) recorded in `tests/corpus/corpus_baseline.json`.** The run exits
non-zero on any regression beyond 0.01. Baselines only move forward, via
`--rebless`, and the commit that reblesses must say why.

Every run also writes `tests/corpus/triage/`: side-by-side PNGs (source page
vs converted render) for the ten lowest-scoring pages, with the dominant
differing regions named per page. That directory is the standing fidelity
backlog - the data the next engine iteration attacks first.

### The interstitial

The home page drop zone accepts PDF and image files and converts them in the
browser. A Word, Excel or PowerPoint file routes to the desktop note instead,
because a browser cannot run Office:

| Element | String |
|---|---|
| Heading | `This conversion runs in the desktop app` |
| Body | `Word, Excel and PowerPoint files convert through the copy of Office already on your PC, so the output is what Office itself would produce. A browser cannot run Office, so these conversions live in the desktop app.` |
| Button | `Download BenchPDF 1.0.2 for Windows` |
| Note | `Free during early access. Windows 10 and 11.` |
| Back | `Choose a different file` |

The note replaces the hero drop zone's pricing line rather than adding to it,
so two pricing lines are never on screen at once.

---

## 1. Page inventory

Deployed at `https://benchpdf.pages.dev` from `github.com/zafwaqas-afk/benchpdf-site`
via Cloudflare Pages. Static HTML and CSS, no build step, no framework.

| URL | File | Purpose |
|---|---|---|
| `/` | `index.html` | The working browser converter, nothing else |
| `/tools` | `tools.html` | The tool index and the "What it does" strip |
| `/download` | `download.html` | The desktop app: what it adds, and the download |
| `/signup` | `signup.html` + `functions/api/signup.js` | Three-step early-access sign-up; POST stores to Cloudflare D1 (`benchpdf` db, binding `DB`, schema in `schema.sql`) |
| `/privacy` | `privacy.html` | What happens to your files, in plain English |
| `/changelog` | `changelog.html` | Released versions |
| `/blog` | `blog/index.html` | Guides index |
| `/blog/scanned-pdf-no-text` | `blog/scanned-pdf-no-text.html` | Guide |
| `/blog/pdf-to-word-formatting` | `blog/pdf-to-word-formatting.html` | Guide |
| `/tools/pdf-to-ppt` | `tools/pdf-to-ppt.html` | Browser tool |
| `/tools/pdf-to-images` | `tools/pdf-to-images.html` | Browser tool |
| `/tools/pdf-to-text` | `tools/pdf-to-text.html` | Browser tool |
| `/tools/images-to-pdf` | `tools/images-to-pdf.html` | Browser tool |
| `/tools/pdf-to-word` | `tools/pdf-to-word.html` | Desktop tool |
| `/tools/word-to-pdf` | `tools/word-to-pdf.html` | Desktop tool |
| `/tools/excel-to-pdf` | `tools/excel-to-pdf.html` | Desktop tool |
| `/tools/ppt-to-pdf` | `tools/ppt-to-pdf.html` | Desktop tool |
| `/tools/web-to-pdf` | `tools/web-to-pdf.html` | Desktop tool |
| `/tools/edit-pdf` | `tools/edit-pdf.html` | Desktop tool |

Retired: `/convert` used to hold the browser converter. It now 301s to `/` via
`_redirects`. Do not recreate it. The converter lives in the home page hero.

URLs are extensionless. Cloudflare serves `foo.html` at `/foo` and 308s the
`.html` form, so every internal link, canonical, and sitemap entry uses the
extensionless form.

---

## 2. Navigation

**One top bar, on every page, visible at all times. No overlay, no hamburger,
no second nav system.** The same four items appear at every viewport width.

| Position | Label | Destination |
|---|---|---|
| Left | `benchpdf` (wordmark, `pdf` in the brand span) | `/` |
| Right | Tools | `/tools` |
| Right | Privacy | `/privacy` |
| Right | Sign up | `/signup` (`.nav-signup`, small etched mono control, inline with nav text) |
| Right | theme toggle | button `#theme-toggle`, aria-label `Switch between light and dark mode` |
| Right | Download | `/download` (the navbar instance of the Download signature block) |

Download is the only filled element in the header; Tools and Privacy stay
text links. The Download signature is a near-black rectangle with lime mono
caps, identical in both themes, on every page and at every width. The toggle
sits between Privacy and Download; sun and moon are inline SVGs and the active
side is lit. Initial theme comes from localStorage then prefers-color-scheme
(dark default), set by an inline head script before first paint on every page.

`Tools` points at `/tools`, the tool index page (moved off the home page on
2026-07-20; the home page is the converter and nothing else). The old `/#tools`
anchor is gone.

**Footer, every page**, in this order: Blog, Changelog, Privacy, Source.
Blog and Changelog appear in the footer only, never in the top bar.

---

## 3. CTA hierarchy

**One primary call to action per viewport height of page.** Nothing else is
styled at primary weight.

On the home page:

1. Hero viewport: the **drop zone** is the primary action. There is no pill
   button competing with it. The `Download` top-bar item is plain nav text.
2. Tools section: plain list links, names only, no primary styling and no
   descriptive notes. The desktop group closes with the download pill.

The desktop group in the tools section closes with the one download pill on
the home page, a full viewport below the hero, linking straight to the GitHub
latest release. The `Download` nav item still lands on `/download`, which
carries the requirements and the honest feature list.

The hero eyebrow is the literal statement `Online PDF converter`, reinstated
on 2026-07-20 from peer feedback: a visitor and a search engine need the plain
words. First-viewport word budget holds: eyebrow (3) plus headline (6) is 9
words before the drop zone, under the 15-word ceiling.

Below the tool grid, two sections returned that the earlier slimming pass
removed, and on 2026-07-20 the steps row moved INTO the hero under the badge
so the instructions are visible on landing. That reversal is deliberate and
approved: the slimming removed
selling copy, and what returned is literal orientation instead: a three-step
How it works row and a three-item strip naming what the output preserves.

On tool pages: the drop zone (browser tools) or the download pill (desktop
tools) is the single primary. Related links are plain.

---

## 4. The browser/desktop expectation rule

A visitor must never click expecting a web tool and discover a download
requirement after scrolling.

- **Browser tools** must land on a page where the tool is immediately usable.
  The drop zone must be within the first viewport.
- **Desktop tools** must state the requirement in the first line of the lede,
  and show the download button above the fold. They must not show a drop zone.

Every desktop tool lede begins with the exact string
`This one needs the Windows app.`

The home page tool index states this in the group headings before any click.

---

## 5. Copy voice rules

These apply to every user-facing string: headings, body, buttons, labels,
tooltips, empty states, error messages, meta titles and descriptions.

1. **No em-dashes. Not one.** Use a full stop and a new sentence, or a comma.
   Check the entity forms as well as the literal character. Grepping for the
   em-dash character alone will miss `&mdash;`, `&#8212;`, `&ndash;` and
   `&#8211;`, which render identically. That was missed once already.
2. **No mirrored two-part constructions.** Banned shapes include
   `X, nothing Y`, `No accounts. No uploads. No nonsense.`, and
   `It is not just A, it is B`. Say the thing once, plainly.
3. **Labels state facts in normal words.** Not
   `Processed on this device, nothing uploaded` but `Files stay on your computer.`
4. **Read it aloud.** If it sounds like a slogan, rewrite it as a sentence a
   person would say across a desk.
5. No invented numbers, testimonials, review scores, awards, user counts, or
   security claims. If a figure has not been supplied, leave it out.
6. UK English.

---

## 6. Copy deck

Every approved user-facing string, verbatim, by page. Do not change these
without agreement.

### Global

| Element | String |
|---|---|
| Wordmark | `benchpdf` |
| Nav | `Tools` / `Download` / `Privacy` |
| Footer links | `Blog` / `Changelog` / `Privacy` / `Source` |
| Footer year | `2026` |
| Skip link | `Skip to content` |

### Home `/`

| Element | String |
|---|---|
| Title | `BenchPDF: documents that come out the way they went in` |
| Meta description | `Convert a PDF to PowerPoint, images or text and keep the text editable, the layout intact and the file on your own computer. The Windows app adds Word, Excel and editing.` |
| Title | `Online PDF converter \| BenchPDF` |
| H1 (visually hidden) | `PDF converter. Would you like another format for your PDF?` |
| Ghost question (visible, aria-hidden decoration) | `Would you like another format for your PDF?` |
| Drop zone tags | `Input` / `Auto` (mono, aria-hidden) |
| Drop zone heading | `Drop PDF / JPG / PNG` |
| Drop zone sub | `or choose a file` |
| Hero strip | `Drop → Select → Done` |
| Early-access chip | `Free during early access.` on its own line under the strip, a quiet ringed chip linking to `/download` |

The grid is painted on a fixed `.gridlayer` element behind the content on
every page, never as a `background-attachment:fixed` body background (that
hit a Chrome/Windows stale-paint bug that blanked sections below the fold).
The etched fill bands were removed on 2026-07-20 (looked wrong in light
mode); the layer is lines only, green in both themes.

The visible eyebrow and headline are retired; the ghost question and the
hidden h1 carry their jobs. The hero strip replaces the numbered steps row on
the home page (the pricing string keeps its two-placement rule: this strip
and `/download`). Arrows in mono strips are permitted separators.
| Tools group 1 heading | `In your browser` |
| Tools group 1 items | `PDF to Images` / `PDF to Text` / `Images to PDF` / `PDF to PowerPoint` |
| Tools group 2 heading | `In the desktop app` |
| Tools group 2 items | `PDF to Word` / `Word to PDF` / `Excel to PDF` / `PowerPoint to PDF` / `Web page to PDF` / `Edit PDF text` |
| Tools group 2 CTA | `Download BenchPDF 1.0.2 for Windows` (links to the GitHub latest release) |
| Steps | retired on the home page; the hero strip (above) carries the sequence. Tool pages may keep their own steps rows. |
| Keep strip | `Editable text` + `Words arrive as text you can click into and retype, not a picture of a page.` / `Tables stay tables` + `Ruled tables are rebuilt as real tables, with rows and columns you can edit.` / `Layout intact` + `Positions, sizes and backgrounds land where the original put them.` |
| Footer release line | `Latest release: 1.0.0, 15 July 2026. First public version: Office conversions through your own installed Word, Excel and PowerPoint, plus PDF text editing.` |

The hero eyebrow reads `in your browser`, not `for Windows`, because the hero
tool is the browser converter and runs on any operating system. `PDF tools for
Windows` sits on the desktop block, where it is true.

Converter states (shared with tool pages, from `assets/js/convert.js` and the
page markup):

| Element | String |
|---|---|
| Actions heading | `What would you like to do?` |
| Change file | `Choose a different file` |
| Working | `Getting ready` |
| Done heading | `Your file is ready` |
| Download result | `Download` |
| Convert again | `Convert another file` |
| Error heading | `That did not work` |
| Error retry | `Try another file` |

### Tool pages

Each tool page is written around what its output preserves, and states exactly
one honest limitation. Section order is fixed:

1. H1 and lede
2. The tool itself (drop zone) or the download button
3. `What comes through`, four specifics about the output
4. `Where it stops`, one real limitation
5. `How to ...`
6. FAQ, six questions
7. `Related tools`

Browser tools. H1, then lede:

| Page | H1 | Lede |
|---|---|---|
| `/tools/pdf-to-ppt` | `PDF to PowerPoint Converter` | `Drop a PDF below. The words arrive as PowerPoint text boxes you can click into and retype, not as a picture of a page.` |
| `/tools/pdf-to-images` | `PDF to Image Converter` | `Drop a PDF below. Each page is rendered exactly as it appears on screen, at the resolution you choose.` |
| `/tools/pdf-to-text` | `PDF to Text Converter` | `Drop a PDF below. You get the words as a plain text file, with the line and page breaks kept where the document had them.` |
| `/tools/images-to-pdf` | `Images to PDF Converter` | `Drop your photos below. Each one goes into the PDF at its original resolution, in the order you dropped them.` |

Desktop tools. Every lede begins `This one needs the Windows app.`:

| Page | H1 | Lede |
|---|---|---|
| `/tools/pdf-to-word` | `PDF to Word Converter` | `This one needs the Windows app. It hands the PDF to your own copy of Word and uses Word's own import, so the result is what Word itself would produce.` |
| `/tools/word-to-pdf` | `Word to PDF Converter` | `This one needs the Windows app. Your own copy of Word does the export, so the PDF looks exactly like the document on your screen.` |
| `/tools/excel-to-pdf` | `Excel to PDF Converter` | `This one needs the Windows app. Your own copy of Excel does the export, so print areas and calculated values land exactly where Excel puts them.` |
| `/tools/ppt-to-pdf` | `PowerPoint to PDF Converter` | `This one needs the Windows app. Your own copy of PowerPoint does the export, so the slides look exactly as they do in the deck.` |
| `/tools/web-to-pdf` | `Web Page to PDF Converter` | `This one needs the Windows app. It renders the address with a real browser engine on your PC, so the page arrives laid out as a browser draws it.` |
| `/tools/edit-pdf` | `Edit PDF Text` | `This one needs the Windows app. You click a line, retype it, and export. Pages you did not touch come out byte for byte identical.` |

Desktop tool CTA button: `Download BenchPDF 1.0.2 for Windows`

Requirement notes under that button, by page: `Needs Microsoft Word installed.`
(pdf-to-word, word-to-pdf), `Needs Microsoft Excel installed.`,
`Needs Microsoft PowerPoint installed.`, `Windows 10 and 11.` (web-to-pdf,
edit-pdf).

The stated limitation on each page, in one line:

| Page | The limit |
|---|---|
| pdf-to-ppt | Scanned pages have no text to recover and arrive as a picture. Tables are not rebuilt as PowerPoint tables in the browser. |
| pdf-to-images | The output is a picture, so the text is no longer selectable or searchable. |
| pdf-to-text | Columns and tables flatten into one reading order. A scan comes back empty. |
| images-to-pdf | JPG and PNG only, so HEIC needs the desktop app. Nothing is recompressed, so the PDF is large. |
| pdf-to-word | Structure has to be inferred, so multi-column and borderless tables need tidying. Scans need OCR. |
| word-to-pdf | Tracked changes and comments export as displayed, so hide them first. |
| excel-to-pdf | Output depends entirely on the print settings saved in the workbook. |
| ppt-to-pdf | Animations flatten to their finished state. Video becomes its poster frame. |
| web-to-pdf | Pages behind a login cannot be fetched. This is the one feature that makes a network request. |
| edit-pdf | Edited text is redrawn in the nearest installed font, so an unusual embedded typeface will shift slightly. |

Each tool page keeps its FAQ, its how-to steps, its FAQPage and BreadcrumbList
JSON-LD, and its related links.

### Download `/download`

Holds the desktop pitch copy that used to sit on the home page.

| Element | String |
|---|---|
| Title | `Download BenchPDF for Windows` |
| Meta description | `The BenchPDF desktop app for Windows 10 and 11. Converts Word, Excel and PowerPoint through the copy of Office already on your PC, and edits PDF text in place.` |
| Eyebrow | `PDF tools for Windows` |
| H1 | `Download BenchPDF` |
| Lede | `For Word and Excel, the desktop app converts through the copy of Office already on your PC, so the output is what Word and Excel themselves would produce. It also edits PDF text in place.` |
| Button | `Download BenchPDF 1.0.2 for Windows` |
| CTA note | `Free during early access.` |
| Requirements | `Windows 10 and 11. Office conversions need your own copy of Office.` |

Section headings, in order: `What the desktop app adds`, `What it does not do`,
`If you would rather not install anything`.

The grid is names only. Tool names are the link text and carry no descriptive
note, so the tool pages themselves do the explaining.

### Privacy `/privacy`

| Element | String |
|---|---|
| Title | `Privacy \| BenchPDF` |
| H1 | `Privacy` |
| Opening statement | `Your files never leave the device you are sitting at.` |
| Statement note | `The browser tools run as code inside your own browser, and the desktop app converts on your own PC. You can watch your browser's network activity during a conversion and see for yourself that nothing is sent.` |
| Lede | `In plain English: what BenchPDF does with your files, what it doesn't, and what this website collects.` |

Section headings, in order: `The short version`, `What the app does`,
`The online converter`, `The one network request`, `What BenchPDF doesn't do`,
`This website`, `Office automation reliability`, `Licensing and source availability`.

### Changelog `/changelog`

| Element | String |
|---|---|
| Title | `Changelog \| BenchPDF` |
| H1 | `Changelog` |
| Lede | `Every released version of BenchPDF, in order.` |

### Blog `/blog`

| Element | String |
|---|---|
| Title | `BenchPDF Blog: PDF Guides and Explainers` |
| H1 | `Blog` |
| Lede | `Plain-English guides on PDF conversion and editing, and how the different file formats actually work.` |

Posts: `How to Convert a Scanned PDF That's Just Images`,
`Why Does My PDF Lose Formatting in Word?`

---

## 7. Motion budget

The hero runs **one gentle settle and nothing else**. There is no looping
animation and no scroll parallax anywhere on the site.

This is a hard constraint, not a preference. A previous build animated the
hero's clip-path gradient planes on a 20s loop and measured **7 to 10fps**,
which stalled automated screenshots. Measured on the same machine:

| Condition | FPS |
|---|---|
| Looping drift on | 7 to 10 |
| Drift off, drop shadows kept | 53 |
| Drift off, no full-screen blend layer | 60 to 62 |

Do not reintroduce looping transforms on the scene planes, and do not put
`mix-blend-mode` on a full-viewport overlay. `prefers-reduced-motion` disables
the settle.

---

## 8. Art direction: Monochrome & Ember

Replaced the previous Warm Satin & Cobalt palette on 2026-07-20. There is no
blue anywhere in the system, and no accent colour exists apart from the ember
ring described below.

- Ground `#F6F5F2`, panel `#FFFFFF`, recess `#ECEAE6`, hairline `#B7B2A9`
- Text: ink `#2A2723`, muted `#6B655C`. Hierarchy tiers are ink at measured
  alphas (`--ink-soft` .82 = 7.8:1, `--ink-quiet` .68 = 5.0:1, `--ink-faint`
  .66 = 4.7:1 on the ground), so 11px mono labels clear WCAG AA
- The generative hero scene is the same tonal ladder desaturated onto the warm
  neutral hue (38 degrees, saturation capped at 10%): depth kept, colour gone
- **Buttons.** Primary is ink-filled (`#2A2723`, white text). Secondary is the
  outline pill on the hairline. A grey or silver fill on an enabled button is
  forbidden; grey fill is reserved for disabled states only
- **The Download signature.** Every Download CTA (`.btn-download`: home grid,
  `/download`, the desktop interstitial, tool pages, **and the navbar `.nav-cta`
  on every page**) is a primary pill wearing
  an ember ring: `box-shadow: 0 0 0 2px ground, 0 0 0 4px #E57A44`, hover
  deepens to `#D2652F`. The same hex would serve in a dark theme. This ring
  appears on **no other element in the product**, and ember is never borrowed
  for warnings or errors. Focus-visible is the ink outline, never ember. No
  Download CTA may ever render greyed, outline-only, or disabled-looking
- **Links**: ink text, underlined; the underline is muted at rest and full ink
  on hover, so links stay distinguishable without colour
- Selection, spinners, progress and active states: ink
- Semantic colours, the only others in the system: success `#2E7D54`, error
  `#C24A38`, warning `#9A6B1F`. As text they sit on the panel (4.5:1 holds
  there); on the ground they colour icons beside ink text
- Type: unchanged. Bodoni Moda Italic display, IBM Plex Sans/Serif/Mono
- Single light theme, committed: no dark mode and no theme toggle on the site.
  The desktop app carries both themes; its dark tokens are ground `#1B1A18`,
  panel `#242220`, hairline `#3E3B36`, text `#ECEAE5`, muted `#A29C92`, with
  the primary button inverted (`#ECEAE5` fill, `#1B1A18` text) and semantics
  `#4CAF7D` / `#E06A56` / `#D09A3E`
- Verified gate: `grep` of the built CSS finds zero blue-ish values (hue 190
  to 280 at any saturation above 8%), both repos

## 9. Quality gates

Every change to this site must still pass:

- Lighthouse performance ≥90, accessibility ≥95, SEO ≥95 on every page type
  (currently 98 to 99 / 100 / 100 / 100)
- Zero em-dashes in user-facing text, checked as both the literal character
  and the entity forms:
  `grep -rn "—\|&mdash;\|&#8212;\|&ndash;\|&#8211;" --include=*.html .`
- Every nav and footer link lands where its label says, at 1440px and 1024px
- A real conversion completes from the home page drop zone, scripted as
  `tests/site_verify.py` in the app repo: it also asserts the done state
  shows NO empty warning shell (the hidden-attribute regression that shipped
  unnoticed for weeks), that no visible styled box in the done panel is
  empty, and that a genuine warning still renders when set
- The browser/desktop expectation rule holds on all ten tool pages

### Ghost question animation

The hero question types itself out on load (26ms a character, mono cursor
that blinks then leaves). Reduced motion gets the full line instantly. The
visually hidden h1 is untouched by the animation.

### Sign up (pending feature)

When the sign-up journey lands, its nav entry uses `.nav-signup`: a small
etched mono control inline with the nav text, never a filled block. The
Download signature stays the only filled element in the header.

---

## 9. Sign-up (added 2026-07-21)

Three steps on `/signup`: essentials (name, email), optional calibration
questions (skippable as a group), explicit consent. Honeypot field `company`
plus a minimum-elapsed-time check server-side; duplicate emails return
success. No third-party scripts. Success stays on the page with `Back to
converting`. Second entry point: the converter done-state line
`Want early-access updates? Sign up.`

Copy deck additions (verbatim): lede `Leave your details to hear about early
access as it changes. The optional questions steer what gets built next.`;
consent copy as on the page; consent checkbox `Store my details for
early-access updates.`; success `You are on the early-access list.`

Data readout is a documented wrangler query in the README; there is no export
endpoint. The privacy page's deletion contact is the GitHub issues link,
**temporary** until a custom domain and real address exist, then it must be
replaced here and on `/privacy`. No emails are sent today and the consent
copy says so; do not add newsletter language until sending exists.
