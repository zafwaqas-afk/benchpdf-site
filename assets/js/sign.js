/* Fill & Sign - a client-side PDF annotation editor.
 *
 * The PDF is opened, drawn, and rewritten entirely in the browser; the file
 * and the signature never leave the page. pdf.js renders the pages for
 * viewing; pdf-lib draws the added marks back onto the ORIGINAL bytes, so
 * nothing in the source is rebuilt or re-encoded; only new content is laid
 * on top, exactly the deterministic, no-reconstruction operation this engine
 * is good at.
 *
 * Every annotation stores its position as a FRACTION of the page (top-left
 * origin). Display scale therefore never enters the export math: a mark at
 * (0.5, 0.5) is the page centre whether the page is drawn at 600px or 1600px.
 */

let pdfjsLib = null;
let vendorReady = null;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src; s.async = false;
    s.onload = resolve;
    s.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(s);
  });
}

function ensureVendor() {
  if (!vendorReady) {
    vendorReady = (async () => {
      const [pdfjsMod] = await Promise.all([
        import("/assets/vendor/pdfjs/pdf.min.mjs"),
        window.PDFLib ? Promise.resolve() : loadScript("/assets/vendor/pdf-lib.min.js"),
      ]);
      pdfjsLib = pdfjsMod;
      pdfjsLib.GlobalWorkerOptions.workerSrc = "/assets/vendor/pdfjs/pdf.worker.min.mjs";
    })();
  }
  return vendorReady;
}

/* ---- DOM ---------------------------------------------------------------- */
const dropStage = document.getElementById("fs-drop-stage");
const editor = document.getElementById("fs-editor");
const dropzone = document.getElementById("dropzone");
const fileInput = document.getElementById("file");
const browseBtn = document.getElementById("browse");
const pagesEl = document.getElementById("fs-pages");
const hintEl = document.getElementById("fs-hint");
const rotateNote = document.getElementById("fs-rotate-note");
const fontSel = document.getElementById("fs-fontsize");
const downloadBtn = document.getElementById("fs-download");
const resetBtn = document.getElementById("fs-reset");
const errBox = document.getElementById("conv-error");
const errBody = document.getElementById("err-body");
const errRetry = document.getElementById("err-retry");
const toolBtns = [...document.querySelectorAll(".fs-tool[data-fstool]")];

// signature dialog
const modal = document.getElementById("fs-modal");
const tabDraw = document.getElementById("fs-tab-draw");
const tabType = document.getElementById("fs-tab-type");
const paneDraw = document.getElementById("fs-pane-draw");
const paneType = document.getElementById("fs-pane-type");
const pad = document.getElementById("fs-pad");
const typeIn = document.getElementById("fs-type-in");
const sigClear = document.getElementById("fs-sig-clear");
const sigCancel = document.getElementById("fs-sig-cancel");
const sigApply = document.getElementById("fs-sig-apply");

/* ---- state -------------------------------------------------------------- */
let pdfBytes = null;                // original file bytes (Uint8Array copy)
let fileName = "document.pdf";
const pages = [];                   // {index, el, wPt, hPt, rotation, pxPerPt}
let annos = [];                     // {id, type, pageIndex, xFrac, yFrac, fontPt, text, dataUrl, wFrac, hFrac, el}
let currentTool = null;
let signatureDataUrl = null;        // reused for repeat placements
let annoSeq = 0;

const MAX_PAGE_W = 900;             // display cap; export uses true page points

/* ---- file intake -------------------------------------------------------- */
function showError(msg) {
  editor.hidden = true;
  dropStage.hidden = true;
  errBox.style.display = "block";
  errBody.textContent = msg;
}

dropzone.addEventListener("click", (e) => {
  if (e.target.closest("#browse") || e.target === dropzone) fileInput.click();
});
dropzone.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fileInput.click(); }
});
browseBtn.addEventListener("click", (e) => { e.stopPropagation(); fileInput.click(); });
["dragenter", "dragover"].forEach((t) =>
  dropzone.addEventListener(t, (e) => { e.preventDefault(); dropzone.classList.add("is-over"); }));
["dragleave", "drop"].forEach((t) =>
  dropzone.addEventListener(t, (e) => { e.preventDefault(); dropzone.classList.remove("is-over"); }));
dropzone.addEventListener("drop", (e) => {
  const f = e.dataTransfer.files[0];
  if (f) openFile(f);
});
fileInput.addEventListener("change", () => {
  if (fileInput.files[0]) openFile(fileInput.files[0]);
});
errRetry.addEventListener("click", () => location.reload());
resetBtn.addEventListener("click", () => location.reload());

async function openFile(file) {
  if (!/\.pdf$/i.test(file.name) && file.type !== "application/pdf") {
    showError("That is not a PDF. Choose a .pdf file to fill and sign.");
    return;
  }
  fileName = file.name;
  try {
    const buf = await file.arrayBuffer();
    pdfBytes = new Uint8Array(buf);
    await ensureVendor();
    // pdf.js consumes (and detaches) the buffer it is given, so hand it a copy
    // and keep pdfBytes intact for pdf-lib at export time.
    const doc = await pdfjsLib.getDocument({ data: pdfBytes.slice() }).promise;
    await renderAll(doc);
    dropStage.hidden = true;
    editor.hidden = false;
  } catch (err) {
    showError("This PDF could not be opened. It may be encrypted or damaged.");
  }
}

async function renderAll(doc) {
  pagesEl.innerHTML = "";
  pages.length = 0;
  let anyRotated = false;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);

  for (let i = 0; i < doc.numPages; i++) {
    const page = await doc.getPage(i + 1);
    const rotation = page.rotate % 360;
    if (rotation !== 0) anyRotated = true;
    const base = page.getViewport({ scale: 1 });
    const scale = Math.min(MAX_PAGE_W / base.width, 1.6);
    const vp = page.getViewport({ scale });

    const pageEl = document.createElement("div");
    pageEl.className = "fs-page";
    pageEl.style.width = `${vp.width}px`;
    pageEl.style.height = `${vp.height}px`;

    const canvas = document.createElement("canvas");
    canvas.width = Math.round(vp.width * dpr);
    canvas.height = Math.round(vp.height * dpr);
    canvas.style.width = `${vp.width}px`;
    canvas.style.height = `${vp.height}px`;
    const ctx = canvas.getContext("2d");
    ctx.scale(dpr, dpr);
    pageEl.appendChild(canvas);
    pagesEl.appendChild(pageEl);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;

    // true page size in points, rotation-normalised so a 90/270 page reports
    // the dimensions the viewer shows
    const rot = rotation === 90 || rotation === 270;
    const wPt = rot ? base.height : base.width;
    const hPt = rot ? base.width : base.height;
    const idx = i;
    pages.push({ index: idx, el: pageEl, wPt, hPt, rotation });
    pageEl.addEventListener("pointerdown", (e) => onPagePointerDown(e, idx));
  }
  rotateNote.hidden = !anyRotated;
}

/* ---- tool selection ----------------------------------------------------- */
toolBtns.forEach((btn) => {
  btn.addEventListener("click", () => {
    const t = btn.dataset.fstool;
    currentTool = currentTool === t ? null : t;
    toolBtns.forEach((b) =>
      b.setAttribute("aria-pressed", String(b.dataset.fstool === currentTool)));
    hintEl.textContent = currentTool
      ? `Click on the page to place ${currentTool === "signature" ? "your signature" : currentTool}.`
      : "Pick a tool, then click on the page where you want it.";
    if (currentTool === "signature" && !signatureDataUrl) openModal();
  });
});

function clearToolPressed() {
  currentTool = null;
  toolBtns.forEach((b) => b.setAttribute("aria-pressed", "false"));
}

/* ---- placement ---------------------------------------------------------- */
function onPagePointerDown(e, pageIndex) {
  // only the empty page surface places new marks; clicks on an existing
  // annotation are handled by that element (drag / edit)
  if (e.target.closest(".fs-anno")) return;
  if (!currentTool) return;
  const page = pages[pageIndex];
  const rect = page.el.getBoundingClientRect();
  const xFrac = (e.clientX - rect.left) / rect.width;
  const yFrac = (e.clientY - rect.top) / rect.height;
  const fontPt = parseInt(fontSel.value, 10) || 12;

  if (currentTool === "signature") {
    if (!signatureDataUrl) { openModal(); return; }
    placeImage(page, xFrac, yFrac, signatureDataUrl);
  } else {
    let text = "";
    if (currentTool === "date") text = new Date().toLocaleDateString();
    else if (currentTool === "check") text = "X";
    placeText(page, xFrac, yFrac, text, fontPt, currentTool === "text");
  }
  clearToolPressed();
  hintEl.textContent = "Drag to reposition. The red handle removes a mark.";
}

function makeAnno(page, xFrac, yFrac) {
  const el = document.createElement("div");
  el.className = "fs-anno";
  el.style.left = `${xFrac * 100}%`;
  el.style.top = `${yFrac * 100}%`;
  const del = document.createElement("button");
  del.type = "button"; del.className = "fs-del"; del.textContent = "×";
  del.setAttribute("aria-label", "Remove");
  el.appendChild(del);
  page.el.appendChild(el);
  return { el, del };
}

function pxPerPt(page) {
  return page.el.getBoundingClientRect().width / page.wPt;
}

function placeText(page, xFrac, yFrac, text, fontPt, editable) {
  const { el, del } = makeAnno(page, xFrac, yFrac);
  const span = document.createElement("div");
  span.className = "fs-anno-text";
  span.textContent = text;
  span.style.fontSize = `${fontPt * pxPerPt(page)}px`;
  if (editable) { span.contentEditable = "true"; span.spellcheck = false; }
  el.appendChild(span);

  const a = { id: ++annoSeq, type: "text", pageIndex: page.index,
    xFrac, yFrac, fontPt, get text() { return span.textContent; }, el };
  annos.push(a);
  wireAnno(a, page, span);
  del.addEventListener("click", (ev) => { ev.stopPropagation(); removeAnno(a); });
  // clicking anywhere on the box focuses the editable text
  el.addEventListener("click", (ev) => {
    if (editable && !ev.target.classList.contains("fs-del")) span.focus();
  });
  // Defer focus past the click that created this box. Focusing synchronously
  // inside the placing pointerdown gets undone by the trailing click landing
  // on the page, so the caret never actually lands here.
  if (editable) setTimeout(() => { span.focus(); selectAll(span); }, 0);
}

function placeImage(page, xFrac, yFrac, dataUrl) {
  const { el, del } = makeAnno(page, xFrac, yFrac);
  el.classList.add("fs-anno-img");
  const img = document.createElement("img");
  img.src = dataUrl;
  el.appendChild(img);
  const grip = document.createElement("div");
  grip.className = "fs-grip";
  el.appendChild(grip);

  // default signature width ~30% of page; height from image aspect
  const a = { id: ++annoSeq, type: "image", pageIndex: page.index,
    xFrac, yFrac, dataUrl, wFrac: 0.3, hFrac: 0.1, el };
  const tmp = new Image();
  tmp.onload = () => {
    const aspect = tmp.height / tmp.width;
    a.hFrac = a.wFrac * aspect * (page.wPt / page.hPt);
    applyImageSize(a, page);
  };
  tmp.src = dataUrl;
  annos.push(a);
  wireAnno(a, page, el);
  wireResize(a, page, grip);
  del.addEventListener("click", (ev) => { ev.stopPropagation(); removeAnno(a); });
}

function applyImageSize(a, page) {
  a.el.style.width = `${a.wFrac * 100}%`;
  a.el.style.height = `${a.hFrac * 100}%`;
}

function selectAnno(a) {
  annos.forEach((x) => x.el.classList.toggle("is-sel", x === a));
}

function removeAnno(a) {
  a.el.remove();
  annos = annos.filter((x) => x !== a);
}

/* ---- drag --------------------------------------------------------------- */
function wireAnno(a, page, inner) {
  inner.addEventListener("pointerdown", (e) => {
    // let a contenteditable text box take the caret on a plain click
    if (a.type === "text" && inner.isContentEditable && e.detail > 1) return;
    if (e.target.classList.contains("fs-grip")) return;
    if (e.target.classList.contains("fs-del")) return;
    e.stopPropagation();
    selectAnno(a);
    const rect = page.el.getBoundingClientRect();
    const startX = e.clientX, startY = e.clientY;
    const ox = a.xFrac, oy = a.yFrac;
    let moved = false;
    const move = (ev) => {
      const dx = (ev.clientX - startX) / rect.width;
      const dy = (ev.clientY - startY) / rect.height;
      if (Math.abs(dx) + Math.abs(dy) > 0.004) moved = true;
      a.xFrac = clamp(ox + dx, 0, 0.999);
      a.yFrac = clamp(oy + dy, 0, 0.999);
      a.el.style.left = `${a.xFrac * 100}%`;
      a.el.style.top = `${a.yFrac * 100}%`;
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      // a drag on editable text should not also drop the caret mid-drag
      if (moved && a.type === "text" && inner.isContentEditable) inner.blur();
    };
    // don't hijack the caret when the user just wants to type
    if (!(a.type === "text" && inner.isContentEditable)) e.preventDefault();
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  });
}

function wireResize(a, page, grip) {
  grip.addEventListener("pointerdown", (e) => {
    e.stopPropagation(); e.preventDefault();
    selectAnno(a);
    const rect = page.el.getBoundingClientRect();
    const startX = e.clientX;
    const ow = a.wFrac, oh = a.hFrac;
    const move = (ev) => {
      const dw = (ev.clientX - startX) / rect.width;
      const nw = clamp(ow + dw, 0.04, 1);
      a.hFrac = oh * (nw / ow);
      a.wFrac = nw;
      applyImageSize(a, page);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  });
}

/* live font-size change for the selected text mark */
fontSel.addEventListener("change", () => {
  const sel = annos.find((x) => x.el.classList.contains("is-sel") && x.type === "text");
  if (!sel) return;
  sel.fontPt = parseInt(fontSel.value, 10) || 12;
  const page = pages[sel.pageIndex];
  sel.el.querySelector(".fs-anno-text").style.fontSize = `${sel.fontPt * pxPerPt(page)}px`;
});

/* ---- signature dialog --------------------------------------------------- */
let padCtx = null, drawing = false, padDirty = false;

function openModal() {
  modal.classList.add("is-open");
  setTab("draw");
  clearPad();
  typeIn.value = "";
}
function closeModal() { modal.classList.remove("is-open"); }

function setTab(which) {
  const draw = which === "draw";
  tabDraw.setAttribute("aria-selected", String(draw));
  tabType.setAttribute("aria-selected", String(!draw));
  paneDraw.hidden = !draw;
  paneType.hidden = draw;
}
tabDraw.addEventListener("click", () => setTab("draw"));
tabType.addEventListener("click", () => setTab("type"));

function clearPad() {
  padCtx = pad.getContext("2d");
  padCtx.clearRect(0, 0, pad.width, pad.height);
  padDirty = false;
}
function padPos(e) {
  const r = pad.getBoundingClientRect();
  return { x: (e.clientX - r.left) * (pad.width / r.width),
           y: (e.clientY - r.top) * (pad.height / r.height) };
}
pad.addEventListener("pointerdown", (e) => {
  drawing = true; padDirty = true;
  padCtx = pad.getContext("2d");
  padCtx.strokeStyle = "#111"; padCtx.lineWidth = 3.2;
  padCtx.lineCap = "round"; padCtx.lineJoin = "round";
  const p = padPos(e);
  padCtx.beginPath(); padCtx.moveTo(p.x, p.y);
  pad.setPointerCapture(e.pointerId);
});
pad.addEventListener("pointermove", (e) => {
  if (!drawing) return;
  const p = padPos(e);
  padCtx.lineTo(p.x, p.y); padCtx.stroke();
});
pad.addEventListener("pointerup", () => { drawing = false; });
sigClear.addEventListener("click", () => { clearPad(); typeIn.value = ""; });
sigCancel.addEventListener("click", () => { closeModal(); clearToolPressed(); });

sigApply.addEventListener("click", () => {
  const typing = tabType.getAttribute("aria-selected") === "true";
  const url = typing ? typedSignatureUrl(typeIn.value.trim()) : drawnSignatureUrl();
  if (!url) return;
  signatureDataUrl = url;
  closeModal();
  // place immediately at a default spot on the first page if the user came
  // from the toolbar; otherwise the pending page click already queued one
  currentTool = "signature";
});

function drawnSignatureUrl() {
  if (!padDirty) return null;
  return trimCanvas(pad);
}

function typedSignatureUrl(name) {
  if (!name) return null;
  const c = document.createElement("canvas");
  const scale = 3;
  c.width = 900; c.height = 260;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#111";
  ctx.textBaseline = "middle";
  let size = 120;
  ctx.font = `${size}px "Segoe Script","Brush Script MT","Snell Roundhand",cursive`;
  while (ctx.measureText(name).width > c.width - 40 && size > 24) {
    size -= 4;
    ctx.font = `${size}px "Segoe Script","Brush Script MT","Snell Roundhand",cursive`;
  }
  ctx.fillText(name, 20, c.height / 2);
  return trimCanvas(c);
}

// crop transparent margins so the placed signature sits tight to the ink
function trimCanvas(src) {
  const w = src.width, h = src.height;
  const ctx = src.getContext("2d");
  const data = ctx.getImageData(0, 0, w, h).data;
  let minX = w, minY = h, maxX = 0, maxY = 0, found = false;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] > 12) {
        found = true;
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }
  }
  if (!found) return null;
  const pad = 8;
  minX = Math.max(0, minX - pad); minY = Math.max(0, minY - pad);
  maxX = Math.min(w - 1, maxX + pad); maxY = Math.min(h - 1, maxY + pad);
  const cw = maxX - minX + 1, ch = maxY - minY + 1;
  const out = document.createElement("canvas");
  out.width = cw; out.height = ch;
  out.getContext("2d").drawImage(src, minX, minY, cw, ch, 0, 0, cw, ch);
  return out.toDataURL("image/png");
}

/* ---- export ------------------------------------------------------------- */
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

async function dataUrlToBytes(url) {
  const res = await fetch(url);
  const buf = await res.arrayBuffer();
  return new Uint8Array(buf);
}

downloadBtn.addEventListener("click", async () => {
  if (!pdfBytes) return;
  downloadBtn.setAttribute("aria-disabled", "true");
  const prev = downloadBtn.textContent;
  downloadBtn.textContent = "Preparing…";
  try {
    await ensureVendor();
    const { PDFDocument, StandardFonts, rgb } = window.PDFLib;
    const out = await PDFDocument.load(pdfBytes);
    const font = await out.embedFont(StandardFonts.Helvetica);
    const outPages = out.getPages();

    for (const a of annos) {
      const page = pages[a.pageIndex];
      const pdfPage = outPages[a.pageIndex];
      const { width: wPt, height: hPt } = pdfPage.getSize();

      if (a.type === "text") {
        const txt = a.text;
        if (!txt) continue;
        const size = a.fontPt;
        const x = a.xFrac * wPt;
        // yFrac is the top of the box (top-left origin); pdf-lib's y is the
        // text baseline from the bottom. Drop by ~0.80*size so the glyph top
        // lands where the on-screen box top is.
        const y = hPt - a.yFrac * hPt - size * 0.80;
        pdfPage.drawText(txt, { x, y, size, font, color: rgb(0.07, 0.07, 0.07) });
      } else {
        const png = await out.embedPng(await dataUrlToBytes(a.dataUrl));
        const w = a.wFrac * wPt;
        const h = a.hFrac * hPt;
        const x = a.xFrac * wPt;
        const y = hPt - a.yFrac * hPt - h;   // drawImage y is the image bottom
        pdfPage.drawImage(png, { x, y, width: w, height: h });
      }
    }

    const bytes = await out.save();
    const blob = new Blob([bytes], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName.replace(/\.pdf$/i, "") + "-signed.pdf";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  } catch (err) {
    alert("The signed PDF could not be built. Please try again.");
  } finally {
    downloadBtn.removeAttribute("aria-disabled");
    downloadBtn.textContent = prev;
  }
});

/* ---- misc --------------------------------------------------------------- */
function selectAll(el) {
  const r = document.createRange();
  r.selectNodeContents(el);
  const s = window.getSelection();
  s.removeAllRanges(); s.addRange(r);
}
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && modal.classList.contains("is-open")) {
    closeModal(); clearToolPressed();
  }
});
