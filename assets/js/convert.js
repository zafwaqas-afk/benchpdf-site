const CMAP_URL = "/assets/vendor/pdfjs/cmaps/";
const STANDARD_FONT_URL = "/assets/vendor/pdfjs/standard_fonts/";

// The conversion libraries (~1.3MB combined) are loaded on demand, only once
// the visitor actually runs a conversion — not on page load — so a casual
// visit to this page stays as fast as any other page on the site.
let pdfjsLib = null;
let vendorReady = null;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    // Dynamically created scripts default to async=true and can execute out
    // of order. Keep insertion order deterministic so a library that expects
    // another to already be defined is never disappointed.
    s.async = false;
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
        window.JSZip ? Promise.resolve() : loadScript("/assets/vendor/jszip.min.js"),
        window.PDFLib ? Promise.resolve() : loadScript("/assets/vendor/pdf-lib.min.js"),
        window.PptxGenJS ? Promise.resolve() : loadScript("/assets/vendor/pptxgen.min.js"),
      ]);
      pdfjsLib = pdfjsMod;
      pdfjsLib.GlobalWorkerOptions.workerSrc = "/assets/vendor/pdfjs/pdf.worker.min.mjs";
    })();
  }
  return vendorReady;
}

// A page can embed a single conversion (e.g. tools/pdf-to-ppt.html) by
// setting <body data-tool="pdf-to-pptx">. In that mode there's no
// action-picker step: a valid file is converted immediately, and the wrong
// file type gets a tool-specific message instead of the generic one.
const TOOL_MODE = document.body.dataset.tool || "all";

const main = document.getElementById("main");
const dropzone = document.getElementById("dropzone");
const fileInput = document.getElementById("file");
const browseBtn = document.getElementById("browse");
const actType = document.getElementById("act-type");
const actName = document.getElementById("act-name");
const actSize = document.getElementById("act-size");
const actCancel = document.getElementById("act-cancel");
const actionList = document.getElementById("action-list");
const actionExtra = document.getElementById("action-extra");
const workPhase = document.getElementById("work-phase");
const doneNotice = document.getElementById("done-notice");
const doneNoticeText = document.getElementById("done-notice-text");
const resultName = document.getElementById("result-name");
const resultSize = document.getElementById("result-size");
const resultDownload = document.getElementById("result-download");
const doneMore = document.getElementById("done-more");
const errBody = document.getElementById("err-body");
const errRetry = document.getElementById("err-retry");
const desktopBack = document.getElementById("desktop-back");

let currentFiles = [];
let currentKind = null;
let imageFormat = "png";
let imageDpi = 150;

// Optional static format/DPI selects on a single-tool "pdf-to-images" page
// (the multi-tool hub builds its own selects dynamically instead).
const imgFormatSel = document.getElementById("img-format");
const imgDpiSel = document.getElementById("img-dpi");
if (imgFormatSel) imgFormatSel.addEventListener("change", () => (imageFormat = imgFormatSel.value));
if (imgDpiSel) imgDpiSel.addEventListener("change", () => (imageDpi = parseInt(imgDpiSel.value, 10)));

function setState(state) {
  main.setAttribute("data-state", state);
}

function fmtBytes(n) {
  if (n < 1024) return n + " B";
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
  return (n / (1024 * 1024)).toFixed(1) + " MB";
}

function baseName(name) {
  return name.replace(/\.[^.]+$/, "");
}

function detectKind(fileList) {
  const arr = Array.from(fileList);
  if (arr.length === 0) return { kind: null };
  const allImages = arr.every((f) => /\.(jpe?g|png)$/i.test(f.name));
  if (allImages) return { kind: "images", files: arr };
  if (arr.length === 1 && /\.pdf$/i.test(arr[0].name)) return { kind: "pdf", files: arr };
  if (arr.length === 1 && /\.(docx?|xlsx?|pptx?)$/i.test(arr[0].name)) return { kind: "office", files: arr };
  return { kind: "unsupported" };
}

function groupLines(items) {
  const tol = 2.5;
  const lines = [];
  for (const it of items) {
    if (!it.str || !it.str.trim()) continue;
    const y = it.transform[5];
    const x = it.transform[4];
    let line = lines.find((l) => Math.abs(l.y - y) <= tol);
    if (!line) {
      line = { y, items: [] };
      lines.push(line);
    }
    line.items.push({ x, str: it.str, transform: it.transform, width: it.width });
  }
  lines.sort((a, b) => b.y - a.y);
  for (const l of lines) l.items.sort((a, b) => a.x - b.x);
  return lines;
}

async function pdfToText(file, onProgress) {
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf, cMapUrl: CMAP_URL, cMapPacked: true }).promise;
  const pages = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    onProgress(`Extracting text — page ${i} of ${pdf.numPages}`);
    const page = await pdf.getPage(i);
    const tc = await page.getTextContent();
    const lines = groupLines(tc.items);
    pages.push(lines.map((l) => l.items.map((it) => it.str).join(" ")).join("\n"));
  }
  return new Blob([pages.join("\f")], { type: "text/plain" });
}

async function pdfToImages(file, opts, onProgress) {
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  const zip = new JSZip();
  const scale = opts.dpi / 72;
  for (let i = 1; i <= pdf.numPages; i++) {
    onProgress(`Rendering page ${i} of ${pdf.numPages}`);
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    const ctx = canvas.getContext("2d");
    await page.render({ canvasContext: ctx, viewport }).promise;
    const mime = opts.format === "jpg" ? "image/jpeg" : "image/png";
    const blob = await new Promise((res) => canvas.toBlob(res, mime, 0.92));
    const ext = opts.format === "jpg" ? "jpg" : "png";
    zip.file(`page-${String(i).padStart(3, "0")}.${ext}`, blob);
  }
  onProgress("Zipping…");
  return await zip.generateAsync({ type: "blob" });
}

async function imagesToPdf(files, onProgress) {
  const doc = await PDFLib.PDFDocument.create();
  for (let i = 0; i < files.length; i++) {
    onProgress(`Adding image ${i + 1} of ${files.length}`);
    const f = files[i];
    const bytes = await f.arrayBuffer();
    const isPng = /\.png$/i.test(f.name) || f.type === "image/png";
    const img = isPng ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
    const wPt = img.width * 0.75;
    const hPt = img.height * 0.75;
    const page = doc.addPage([wPt, hPt]);
    page.drawImage(img, { x: 0, y: 0, width: wPt, height: hPt });
  }
  onProgress("Finishing PDF…");
  const bytes = await doc.save();
  return new Blob([bytes], { type: "application/pdf" });
}

function renderActions(kind, files) {
  actionList.innerHTML = "";
  actionExtra.hidden = true;

  if (kind === "pdf") {
    actType.textContent = "PDF";
    actName.textContent = files[0].name;
    actSize.textContent = fmtBytes(files[0].size);

    addAction("Convert to PowerPoint", "Editable slides. Tables stay tables.", () => runPptx(files[0]));
    addAction("Convert to Images", "One PNG or JPG per page, zipped.", () => runImages(files[0]));
    addAction("Extract Text", "Plain text, one form-feed between pages.", () => runText(files[0]));

    actionExtra.hidden = false;
    actionExtra.innerHTML = "";
    const label = document.createElement("span");
    label.textContent = "Image settings:";
    const fmtSel = document.createElement("select");
    fmtSel.innerHTML = '<option value="png">PNG</option><option value="jpg">JPG</option>';
    fmtSel.addEventListener("change", () => (imageFormat = fmtSel.value));
    const dpiSel = document.createElement("select");
    dpiSel.innerHTML = '<option value="96">96 DPI</option><option value="150" selected>150 DPI</option><option value="300">300 DPI</option>';
    dpiSel.addEventListener("change", () => (imageDpi = parseInt(dpiSel.value, 10)));
    actionExtra.append(label, fmtSel, dpiSel);
  } else if (kind === "images") {
    actType.textContent = "Images";
    actName.textContent = files.length === 1 ? files[0].name : `${files.length} images`;
    actSize.textContent = fmtBytes(files.reduce((s, f) => s + f.size, 0));
    addAction("Merge to PDF", "Combine into a single PDF, in order.", () => runMerge(files));
  }
  setState("actions");
}

function addAction(label, desc, onClick) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "action";
  btn.innerHTML = `<span class="action-label">${label}</span><span class="action-desc">${desc}</span>`;
  btn.addEventListener("click", onClick);
  actionList.appendChild(btn);
}

function showDone(blob, filename, notice) {
  const url = URL.createObjectURL(blob);
  resultName.textContent = filename;
  resultSize.textContent = fmtBytes(blob.size);
  resultDownload.href = url;
  resultDownload.download = filename;
  doneNotice.hidden = !notice;
  if (notice) doneNoticeText.textContent = notice;
  setState("done");
}

function showError(message) {
  errBody.textContent = message;
  setState("error");
}

// PDF -> PPTX runs the ported fidelity engine (assets/js/engine/), the same
// pipeline the desktop app uses: paragraph clustering, native tables from
// ruling lines, filtered background renders. It shipped only after its column
// in the per-engine fidelity suite went GREEN, and it stays linked only while
// that holds. The engine lazy-loads here, on first use, never at page load.
async function runPptx(file) {
  setState("working");
  try {
    workPhase.textContent = "Loading converter…";
    await ensureVendor();
    const eng = await import("/assets/js/engine/engine.js");
    workPhase.textContent = "Preparing…";
    const bytes = await file.arrayBuffer();
    const { blob } = await eng.convertPdfToPptx(bytes, {
      pdfjs: pdfjsLib, PptxGenJS: window.PptxGenJS,
      PDFLib: window.PDFLib, JSZip: window.JSZip,
    }, (done, total, msg) => (workPhase.textContent = msg));
    showDone(blob, baseName(file.name) + ".pptx");
  } catch (e) {
    console.error(e);
    showError("Couldn't convert that PDF to PowerPoint. " + (e && e.message ? e.message : "Try a different file."));
  }
}

async function runImages(file) {
  setState("working");
  try {
    workPhase.textContent = "Loading converter…";
    await ensureVendor();
    workPhase.textContent = "Preparing…";
    const blob = await pdfToImages(file, { format: imageFormat, dpi: imageDpi }, (p) => (workPhase.textContent = p));
    showDone(blob, baseName(file.name) + "-images.zip");
  } catch (e) {
    console.error(e);
    showError("Couldn't convert that PDF to images. " + (e && e.message ? e.message : "Try a different file."));
  }
}

async function runText(file) {
  setState("working");
  try {
    workPhase.textContent = "Loading converter…";
    await ensureVendor();
    workPhase.textContent = "Preparing…";
    const blob = await pdfToText(file, (p) => (workPhase.textContent = p));
    showDone(blob, baseName(file.name) + ".txt");
  } catch (e) {
    console.error(e);
    showError("Couldn't extract text from that PDF. " + (e && e.message ? e.message : "Try a different file."));
  }
}

async function runMerge(files) {
  setState("working");
  try {
    workPhase.textContent = "Loading converter…";
    await ensureVendor();
    workPhase.textContent = "Preparing…";
    const blob = await imagesToPdf(files, (p) => (workPhase.textContent = p));
    const name = files.length === 1 ? baseName(files[0].name) + ".pdf" : "merged.pdf";
    showDone(blob, name);
  } catch (e) {
    console.error(e);
    showError("Couldn't merge those images. " + (e && e.message ? e.message : "Try different files."));
  }
}

const SINGLE_TOOLS = {
  "pdf-to-pptx": { needKind: "pdf", run: (files) => runPptx(files[0]), wrongMsg: "Drop a PDF file to convert it to PowerPoint." },
  "pdf-to-images": { needKind: "pdf", run: (files) => runImages(files[0]), wrongMsg: "Drop a PDF file to convert it to images." },
  "pdf-to-text": { needKind: "pdf", run: (files) => runText(files[0]), wrongMsg: "Drop a PDF file to extract its text." },
  "images-to-pdf": { needKind: "images", run: (files) => runMerge(files), wrongMsg: "Drop one or more JPG or PNG images to merge into a PDF." },
};

function handleFiles(fileList) {
  const { kind, files } = detectKind(fileList);

  if (TOOL_MODE !== "all") {
    const cfg = SINGLE_TOOLS[TOOL_MODE];
    if (!cfg || kind !== cfg.needKind) {
      showError(cfg ? cfg.wrongMsg : "Unsupported file.");
      return;
    }
    cfg.run(files);
    return;
  }

  if (kind === "pdf" || kind === "images") {
    currentKind = kind;
    currentFiles = files;
    renderActions(kind, files);
  } else if (kind === "office") {
    currentKind = null;
    currentFiles = [];
    setState("desktop");
  } else if (kind === "unsupported") {
    showError("Drop a single PDF, or one or more JPG/PNG images.");
  }
}

dropzone.addEventListener("click", () => fileInput.click());
dropzone.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    fileInput.click();
  }
});
browseBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  fileInput.click();
});
fileInput.addEventListener("change", () => {
  if (fileInput.files.length) handleFiles(fileInput.files);
});
["dragenter", "dragover"].forEach((evt) =>
  dropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    dropzone.classList.add("is-over");
  })
);
["dragleave", "drop"].forEach((evt) =>
  dropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    dropzone.classList.remove("is-over");
  })
);
dropzone.addEventListener("drop", (e) => {
  if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files);
});

if (actCancel) {
  actCancel.addEventListener("click", () => {
    currentFiles = [];
    currentKind = null;
    fileInput.value = "";
    setState("idle");
  });
}
doneMore.addEventListener("click", () => {
  fileInput.value = "";
  setState("idle");
});
errRetry.addEventListener("click", () => {
  fileInput.value = "";
  setState("idle");
});
// Back from the desktop-only note to the file we already have, so the visitor
// does not have to pick it again just to reach a conversion that works here.
if (desktopBack) {
  desktopBack.addEventListener("click", () => {
    fileInput.value = "";
    setState("idle");
  });
}
