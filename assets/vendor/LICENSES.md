# Vendored client-side libraries

Used by the in-browser converter (`/convert.html`). All run entirely in the
visitor's browser — vendored locally (not loaded from a CDN) so the site
makes no third-party requests.

| Library | Version | License | Used for |
|---|---|---|---|
| [pdf.js](https://mozilla.github.io/pdf.js/) | 6.1.200 | Apache-2.0 | Rendering PDF pages to canvas, extracting text and layout |
| [PptxGenJS](https://gitbrent.github.io/PptxGenJS/) | 4.0.1 | MIT | Building .pptx files from extracted PDF content |
| [pdf-lib](https://pdf-lib.js.org/) | 1.17.1 | MIT | Building merged PDFs from images |
| [JSZip](https://stuk.github.io/jszip/) | 3.10.1 | MIT (or GPL-3.0-or-later, dual-licensed) | Zipping exported page images |

None of these are modified from their published builds.
