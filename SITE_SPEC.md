# SITE_SPEC.md

**This file is the source of truth for the BenchPDF marketing site.**

Any session touching this site must read this file before making changes. You
may not change approved copy or navigation without listing every change
explicitly at the top of your summary to the user. If you believe a string or a
nav item should change, say so and get agreement first, then update this file in
the same commit as the change.

Last verified against the shipped site: 2026-07-19.

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
2. Under the download button in the desktop block on `/`.

There is no pricing page and none is to be invented. Desktop tool pages carry a
requirement note under their download button (`Needs Microsoft Word installed.`
and so on) with no pricing claim.

### Structural trust

- The download button reads `Download BenchPDF 1.0.0 for Windows`. The version
  number is part of the string and is updated on each release.
- Every page footer carries the dated latest-release line, linking to
  `/changelog`.
- Every tool page carries exactly one honest limitation, under a `Where it
  stops` heading, before the how-to.
- No testimonials, star ratings, user counts, download counters, awards, or
  security certifications. None have been supplied and none are to be invented.

---

## 1. Page inventory

Deployed at `https://benchpdf.pages.dev` from `github.com/zafwaqas-afk/benchpdf-site`
via Cloudflare Pages. Static HTML and CSS, no build step, no framework.

| URL | File | Purpose |
|---|---|---|
| `/` | `index.html` | The working browser converter, plus the tool index and the promise |
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
| Left | `benchpdf` (wordmark) | `/` |
| Right | Tools | `/#tools` |
| Right | Download | `https://github.com/zafwaqas-afk/benchpdf/releases/latest` |
| Right | Privacy | `/privacy` |

`Tools` points at the tool index section on the home page. That section is the
tool index, so the label is honest. There is no separate `/tools` page.

**Footer, every page**, in this order: Blog, Changelog, Privacy, Source.
Blog and Changelog appear in the footer only, never in the top bar.

---

## 3. CTA hierarchy

**One primary call to action per viewport height of page.** Nothing else is
styled at primary weight.

On the home page:

1. Hero viewport: the **drop zone** is the primary action. There is no pill
   button competing with it. The `Download` top-bar item is plain nav text.
2. Next: the **Download for Windows** pill is primary. The download is the
   upsell, never the opener.
3. Tools section: plain list links, no primary styling.
4. Promise section: one plain text link to the privacy page.

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
| Hero eyebrow | `PDF tools, in your browser` |
| H1 | `Converted. not flattened.` |
| Drop zone heading | `Drop a PDF here to convert it` |
| Drop zone sub | `Or choose a file. You can also drop JPG or PNG images.` |
| Under-CTA line | `Free during early access. Your file stays on your computer.` |
| Desktop block eyebrow | `PDF tools for Windows` |
| Desktop block body | `For Word and Excel, the desktop app converts through the copy of Office already on your PC, so the output is what Word and Excel themselves would produce. It also edits PDF text in place.` |
| Desktop block button | `Download BenchPDF 1.0.0 for Windows` |
| Desktop block note | `Free during early access. Windows 10 and 11.` |
| Tools group 1 heading | `In your browser` |
| Tools group 1 note | `These run here on this page. Nothing to install.` |
| Tools group 2 heading | `In the desktop app` |
| Tools group 2 note | `These need the Windows download.` |
| Promise | `Your files never leave the device you are sitting at.` |
| Promise paragraph | `The browser tools run as code inside your own browser, and the desktop app converts on your own PC. You can watch your browser's network activity during a conversion and see for yourself that nothing is sent.` |
| Promise link | `Read the privacy page` |
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

Desktop tool CTA button: `Download BenchPDF 1.0.0 for Windows`

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

### Privacy `/privacy`

| Element | String |
|---|---|
| Title | `Privacy \| BenchPDF` |
| H1 | `Privacy` |
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

## 8. Art direction

Unchanged by the IA work and not to be altered casually.

- Ground: bone `#F2EDE6`, warm plaster `#E4D6CC`, shadow lilac `#C8C2D8`
- Text: ink `#1A181E` only, at measured alphas (`--ink-soft` 7.9:1,
  `--ink-quiet` 5.7:1, `--ink-faint` 4.7:1 on bone, so 11px labels clear AA)
- Accent: cobalt `#2C4BE0` appears exactly once sitewide, as the download
  button hover fill
- Type: Bodoni Moda Italic for the display collision and quiet statements,
  IBM Plex Sans for everything else, IBM Plex Serif for headings, IBM Plex Mono
  for labels
- All buttons are the same ghost pill
- Single light theme, committed. There is no dark mode and no theme toggle.

---

## 9. Quality gates

Every change to this site must still pass:

- Lighthouse performance ≥90, accessibility ≥95, SEO ≥95 on every page type
  (currently 98 to 99 / 100 / 100 / 100)
- Zero em-dashes in user-facing text, checked as both the literal character
  and the entity forms:
  `grep -rn "—\|&mdash;\|&#8212;\|&ndash;\|&#8211;" --include=*.html .`
- Every nav and footer link lands where its label says, at 1440px and 1024px
- A real conversion completes from the home page drop zone
- The browser/desktop expectation rule holds on all ten tool pages
