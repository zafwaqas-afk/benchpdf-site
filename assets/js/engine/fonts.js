/* Document-wide font mapping: the FontMapper port from app/extraction.py.
 *
 * One deliberate divergence, documented as the port's known parity gap: the
 * desktop engine resolves against the fonts actually installed on the PC.
 * A browser cannot enumerate installed fonts, so this maps to the same
 * metric-compatible target table the Python engine uses, without the local
 * verification step. The table itself is identical.
 */

export const FLAG_ITALIC = 1 << 1;
export const FLAG_MONO = 1 << 3;
export const FLAG_BOLD = 1 << 4;

const METRIC_MAP = [
  ["carlito", "Calibri"], ["calibri", "Calibri"],
  ["arimo", "Arial"], ["arialmt", "Arial"], ["arial", "Arial"],
  ["helvetica", "Arial"], ["liberationsans", "Arial"], ["notosans", "Arial"],
  ["segoeui", "Segoe UI"], ["verdana", "Verdana"], ["tahoma", "Tahoma"],
  ["trebuchet", "Trebuchet MS"],
  ["tinos", "Times New Roman"], ["timesnewroman", "Times New Roman"],
  ["times", "Times New Roman"], ["liberationserif", "Times New Roman"],
  ["georgia", "Georgia"], ["cambria", "Cambria"],
  ["notoserif", "Georgia"], ["ptserif", "Georgia"], ["garamond", "Georgia"],
  ["minion", "Georgia"],
  ["cousine", "Consolas"], ["consolas", "Consolas"],
  ["couriernew", "Courier New"], ["courier", "Courier New"],
  ["liberationmono", "Consolas"],
];
const FALLBACK_SANS = "Arial";
const FALLBACK_SERIF = "Georgia";
const FALLBACK_MONO = "Consolas";
const FALLBACK_SYMBOL = "Segoe UI Symbol";

const SUBSET_PREFIX = /^[A-Z]{6}\+/;
const STYLE_WORDS = /[-,]?\s*(bold|italic|oblique|regular|light|medium|semibold|demibold|black|book|condensed|narrow|roman|mt|ps|psmt)\b/gi;

function cleanFontName(raw) {
  let name = (raw || "").replace(SUBSET_PREFIX, "");
  name = name.replace(STYLE_WORDS, "");
  name = name.replace(/-/g, " ").replace(/,/g, " ");
  return name.replace(/\s+/g, " ").trim();
}

export class FontMapper {
  constructor() {
    this.cache = new Map();
    this.substitutions = new Map();   // "NotoSerif" -> "Georgia"
  }

  map(rawName, flags) {
    if (this.cache.has(rawName)) return this.cache.get(rawName);
    const cleaned = cleanFontName(rawName);
    const low = cleaned.toLowerCase();
    const compact = low.replace(/[^a-z]/g, "");

    let target = null;
    for (const [key, val] of METRIC_MAP) {
      if (compact.includes(key)) { target = val; break; }
    }
    if (target === null) {
      if (["mono", "consol", "courier"].some((k) => low.includes(k)) || (flags & FLAG_MONO)) {
        target = FALLBACK_MONO;
      } else if (low.includes("sans")) {
        target = FALLBACK_SANS;
      } else if (["serif", "times", "roman", "georgia", "cambria", "minion", "garamond"]
                 .some((k) => low.includes(k))) {
        target = FALLBACK_SERIF;
      } else if (["symbol", "wingding", "dingbat", "webding"].some((k) => low.includes(k))) {
        target = FALLBACK_SYMBOL;
      } else {
        target = FALLBACK_SANS;
      }
    }
    this.cache.set(rawName, target);
    const base = cleaned || rawName || "unknown";
    if (base.toLowerCase() !== target.toLowerCase()) {
      this.substitutions.set(base, target);
    }
    return target;
  }
}
