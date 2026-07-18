/* ============================================================================
   PEAR Widget — embeddable virtual try-on button for any store
   ----------------------------------------------------------------------------
   One-line embed:
     <script src="https://pear-web-demo.vercel.app/widget/pear-widget.js"
             data-pear-key="STORE_KEY"></script>

   What it does:
     1. Scans the host page for product images (og:image → known product-image
        selectors → generic large-image heuristic).
     2. Injects a "👗 נסה עלי" button onto each product image.
     3. On click, opens a fullscreen modal with the PEAR fitting room in an
        iframe, handing over the garment via URL params
        (garment_url / garment_type / garment_name), plus an OPTIONAL
        garment_url_back so the live Back view warps from a real rear photo
        instead of a prompt-steered guess off the front image.

   Back-image discovery (opt-in, best-effort): an explicit data-pear-back on the
   product <img> or its container wins; otherwise the widget falls back to the
   next distinct product-gallery image. data-pear-front, when present, overrides
   the scraped front URL.

   Self-contained: no globals leak (everything lives in this IIFE), all CSS is
   injected via a single <style class="pear-widget-styles"> tag, and every class
   name is prefixed "pear-widget-" so nothing collides with the host page.
   ============================================================================ */
(function (w, d) {
  "use strict";

  /* Re-embed guard — a page that includes the script twice gets one widget. */
  if (w.__pearWidgetLoaded) return;
  w.__pearWidgetLoaded = true;

  /* ── configuration ──────────────────────────────────────────────────────── */
  var FALLBACK_BASE = "https://pear-web-demo.vercel.app";

  /* Resolve the PEAR origin from this script's own src so the widget works
     against localhost / preview deployments too; fall back to production. */
  var script = d.currentScript ||
    (function () {
      var s = d.querySelectorAll('script[src*="pear-widget"]');
      return s.length ? s[s.length - 1] : null;
    })();

  var PEAR_BASE = FALLBACK_BASE;
  try {
    if (script && script.src) PEAR_BASE = new URL(script.src).origin;
  } catch (_) {}

  var STORE_KEY = (script && script.getAttribute("data-pear-key")) || "";

  /* Opt-in strict two-view gate: when data-pear-require-both-views is present (and
     not "false"), the fitting room hard-blocks go-live unless a real back image
     arrived. Absent → graceful default (Back view falls back to the front + prompt). */
  var _reqBoth = script ? script.getAttribute("data-pear-require-both-views") : null;
  var REQUIRE_BOTH_VIEWS = _reqBoth !== null && _reqBoth !== "false";

  /* Garment-category keyword map (scanned against product name + page title). */
  var CATEGORY_KEYWORDS = {
    shirt: ["חולצה", "טישרט", "גופייה", "shirt", "tee", "top",
            "blouse", "sweater", "hoodie", "crop"],
    pants: ["מכנסיים", "ג׳ינס", "pants", "jeans", "trousers",
            "shorts", "leggings", "skirt"],
    dress: ["שמלה", "חצאית", "dress", "jumpsuit", "romper"],
    outerwear: ["מעיל", "ג׳קט", "coat", "jacket", "blazer", "cardigan"]
  };
  var DEFAULT_CATEGORY = "tops";

  /* src substrings that mark an image as decorative, never a garment */
  var EXCLUDE_SRC = ["logo", "icon", "sprite", "placeholder", "blank", "pixel"];

  var PRODUCT_IMG_SELECTORS = [
    ".product-image img",
    ".product__media img",
    ".woocommerce-product-gallery img",
    "[data-product-image]",
    ".product-photo img"
  ].join(", ");

  /* ── page metadata helpers ──────────────────────────────────────────────── */
  function getGarmentName() {
    var h1 = d.querySelector("h1");
    var name = h1 && h1.textContent ? h1.textContent.trim() : "";
    return name || d.title || "Garment";
  }

  function detectCategory(name) {
    var haystack = ((name || "") + " " + (d.title || "")).toLowerCase();
    for (var cat in CATEGORY_KEYWORDS) {
      var words = CATEGORY_KEYWORDS[cat];
      for (var i = 0; i < words.length; i++) {
        if (haystack.indexOf(words[i].toLowerCase()) !== -1) return cat;
      }
    }
    return DEFAULT_CATEGORY;
  }

  function isExcludedSrc(src) {
    var s = (src || "").toLowerCase();
    for (var i = 0; i < EXCLUDE_SRC.length; i++) {
      if (s.indexOf(EXCLUDE_SRC[i]) !== -1) return true;
    }
    return false;
  }

  /* ── back-image discovery helpers ───────────────────────────────────────────
     A garment's rear photo lets the fitting room warp the Back view from a real
     reference (e.g. a jersey's back print) instead of inferring it from the front.
     Priority: explicit data-pear-back on the img/container → next distinct product-
     gallery image. data-pear-front, when set, overrides the scraped front URL. */
  function readAttr(el, name) {
    return (el && el.getAttribute && el.getAttribute(name)) || "";
  }

  /* Normalise for comparison — CDNs vary query params, so match on the path only. */
  function samePhoto(a, b) {
    return (a || "").split("?")[0] === (b || "").split("?")[0];
  }

  function explicitAttr(img, name) {
    return readAttr(img, name) || readAttr(img.parentElement, name);
  }

  /* Fall back to the next distinct product-gallery image as an approximate rear
     reference (best-effort — gallery order is a storefront convention, not a rule). */
  function findGalleryBack(primaryUrl) {
    var sel = d.querySelectorAll(PRODUCT_IMG_SELECTORS);
    for (var i = 0; i < sel.length; i++) {
      var el = sel[i];
      if (el.tagName !== "IMG") el = el.querySelector && el.querySelector("img");
      if (!el || el.tagName !== "IMG") continue;
      var src = el.currentSrc || el.src || "";
      if (!src || isExcludedSrc(src) || samePhoto(src, primaryUrl)) continue;
      return src;
    }
    return "";
  }

  /* ── STEP 1 — scan the page for garment images ──────────────────────────── */
  function findProductImages() {
    var found = [];
    var seen = [];

    function push(img) {
      if (!img || seen.indexOf(img) !== -1) return;
      if (isExcludedSrc(img.currentSrc || img.src)) return;
      seen.push(img);
      found.push(img);
    }

    /* Priority 1 — the og:image, when a visible <img> carries the same URL. */
    var og = d.querySelector('meta[property="og:image"]');
    var ogUrl = og && og.content ? og.content : "";
    if (ogUrl) {
      var imgs = d.querySelectorAll("img");
      for (var i = 0; i < imgs.length; i++) {
        var src = imgs[i].currentSrc || imgs[i].src || "";
        /* match on the path part — CDNs often vary query params / protocol */
        if (src && (src === ogUrl || src.split("?")[0] === ogUrl.split("?")[0])) {
          push(imgs[i]);
        }
      }
    }

    /* Priority 2 — well-known product-image selectors. */
    if (!found.length) {
      var sel = d.querySelectorAll(PRODUCT_IMG_SELECTORS);
      for (var j = 0; j < sel.length; j++) {
        var el = sel[j];
        /* [data-product-image] may be the container rather than the img */
        if (el.tagName !== "IMG") el = el.querySelector("img") || el;
        if (el.tagName === "IMG") push(el);
      }
    }

    /* Priority 3 — any big image that doesn't look like chrome/logo. */
    if (!found.length) {
      var all = d.querySelectorAll("img");
      for (var k = 0; k < all.length; k++) {
        var im = all[k];
        if (im.naturalWidth > 200 && im.naturalHeight > 200) push(im);
      }
    }

    /* og:image wins as the garment URL for the page's primary image; an explicit
       data-pear-back (or data-pear-front override) is captured per image. */
    var entries = found.map(function (img, idx) {
      return {
        img: img,
        url: explicitAttr(img, "data-pear-front") ||
             ((idx === 0 && ogUrl) ? ogUrl : (img.currentSrc || img.src)),
        back: explicitAttr(img, "data-pear-back")
      };
    });

    /* Gallery fallback for the primary product: when no explicit rear photo was
       annotated, borrow the next distinct product-gallery image. */
    if (entries.length && !entries[0].back) {
      entries[0].back = findGalleryBack(entries[0].url);
    }

    return entries;
  }

  /* ── shared widget CSS (single removable style tag) ─────────────────────── */
  function injectStyles() {
    if (d.querySelector("style.pear-widget-styles")) return;
    var isRTL = (d.dir || d.documentElement.getAttribute("dir") || "")
                  .toLowerCase() === "rtl";
    var side = isRTL ? "left" : "right";
    var css =
      ".pear-widget-btn{" +
        "position:absolute;bottom:12px;" + side + ":12px;z-index:9999;" +
        "background:#000;color:#fff;border:none;border-radius:24px;" +
        "padding:10px 18px;font-size:13px;font-weight:700;cursor:pointer;" +
        "box-shadow:0 2px 12px rgba(0,0,0,0.25);transition:background 0.2s;" +
        "font-family:inherit;line-height:1.2;" +
      "}" +
      ".pear-widget-btn:hover{background:#00AA44;}" +
      ".pear-widget-btn:disabled{" +
        "opacity:0.45;cursor:not-allowed;pointer-events:none;" +
        "box-shadow:none;" +
      "}" +
      ".pear-widget-btn:disabled:hover{background:#000;}" +
      ".pear-widget-overlay{" +
        "position:fixed;inset:0;z-index:999999;background:rgba(0,0,0,0.88);" +
        "display:flex;align-items:center;justify-content:center;" +
      "}" +
      ".pear-widget-frame{" +
        "width:min(480px,100vw);height:min(820px,100vh);border:none;" +
        "border-radius:16px;background:#000;" +
      "}" +
      ".pear-widget-close{" +
        "position:absolute;top:16px;right:16px;width:40px;height:40px;" +
        "border-radius:50%;background:rgba(255,255,255,0.15);color:#fff;" +
        "font-size:20px;border:none;cursor:pointer;line-height:40px;" +
        "padding:0;text-align:center;" +
      "}" +
      ".pear-widget-close:hover{background:rgba(255,255,255,0.25);}";
    var style = d.createElement("style");
    style.className = "pear-widget-styles";
    style.textContent = css;
    d.head.appendChild(style);
  }

  /* ── single-measurement-per-session guard ─────────────────────────────────
     Once the fitting room has been opened, the try-on counts as "used" for
     this visit. sessionStorage (not a plain in-memory var) so the lock
     survives a page reload within the same tab but clears on a fresh visit.
     A page can inject more than one button (multiple product images), so
     every tracked button is disabled together — no instance can be used to
     route around another's lock. */
  var MEASURE_FLAG_KEY = "pearWidgetHasMeasured";
  var hasMeasured = false;
  try { hasMeasured = w.sessionStorage.getItem(MEASURE_FLAG_KEY) === "1"; } catch (_) {}

  var trackedButtons = [];

  function setButtonDisabled(btn, disabled) {
    btn.disabled = disabled;
    btn.setAttribute("aria-disabled", disabled ? "true" : "false");
    if (disabled) btn.title = "כבר בוצעה מדידה וירטואלית בביקור הזה";
    else btn.removeAttribute("title");
  }

  /* Marks the measurement as used and disables every injected button.
     Called at click-time (not on modal close) so the restriction can't be
     bypassed by opening several modals back-to-back. */
  function lockMeasurement() {
    if (hasMeasured) return;
    hasMeasured = true;
    try { w.sessionStorage.setItem(MEASURE_FLAG_KEY, "1"); } catch (_) {}
    for (var i = 0; i < trackedButtons.length; i++) setButtonDisabled(trackedButtons[i], true);
  }

  /* ── STEP 3 — fullscreen modal with the fitting-room iframe ─────────────── */
  var activeOverlay = null;
  var escHandler = null;

  function closeModal() {
    if (activeOverlay && activeOverlay.parentNode) {
      activeOverlay.parentNode.removeChild(activeOverlay);
    }
    activeOverlay = null;
    if (escHandler) {
      d.removeEventListener("keydown", escHandler);
      escHandler = null;
    }
  }

  function openModal(garment) {
    closeModal(); // never stack two modals

    var params =
      "garment_url=" + encodeURIComponent(garment.url) +
      "&garment_type=" + encodeURIComponent(garment.type) +
      "&garment_name=" + encodeURIComponent(garment.name) +
      (garment.back ? "&garment_url_back=" + encodeURIComponent(garment.back) : "") +
      (REQUIRE_BOTH_VIEWS ? "&require_both_views=1" : "") +
      (STORE_KEY ? "&pear_key=" + encodeURIComponent(STORE_KEY) : "");
    var src = PEAR_BASE + "/fitting-room/?" + params;

    var overlay = d.createElement("div");
    overlay.className = "pear-widget-overlay";

    var iframe = d.createElement("iframe");
    iframe.className = "pear-widget-frame";
    iframe.src = src;
    iframe.title = "PEAR virtual fitting room";
    /* the fitting room needs webcam access inside the cross-origin iframe */
    iframe.setAttribute("allow", "camera; microphone; fullscreen");

    var close = d.createElement("button");
    close.className = "pear-widget-close";
    close.type = "button";
    close.setAttribute("aria-label", "Close");
    close.textContent = "×";
    close.addEventListener("click", closeModal);

    /* close on a click on the dark backdrop (outside the iframe) */
    overlay.addEventListener("click", function (e) {
      if (e.target === overlay) closeModal();
    });

    escHandler = function (e) {
      if (e.key === "Escape") closeModal();
    };
    d.addEventListener("keydown", escHandler);

    overlay.appendChild(iframe);
    overlay.appendChild(close);
    d.body.appendChild(overlay);
    activeOverlay = overlay;
  }

  /* ── STEP 2 — inject a try-on button onto each product image ────────────── */
  function injectButton(entry, name, category) {
    var img = entry.img;
    var container = img.parentElement || img;
    if (container.querySelector && container.querySelector(".pear-widget-btn")) return;

    var pos = "";
    try { pos = w.getComputedStyle(container).position; } catch (_) {}
    if (!pos || pos === "static") container.style.position = "relative";

    var btn = d.createElement("button");
    btn.className = "pear-widget-btn";
    btn.type = "button";
    btn.textContent = "👗 נסה עלי";
    btn.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
      /* Logic safeguard: block re-entry even if a disabled button somehow
         still receives a click (programmatic dispatch, stale reference,
         a second widget instance, etc.) — disabled styling alone is UI,
         this is the actual gate. */
      if (hasMeasured) return;
      lockMeasurement();
      openModal({ url: entry.url, type: category, name: name, back: entry.back });
    });
    setButtonDisabled(btn, hasMeasured);
    trackedButtons.push(btn);
    container.appendChild(btn);
  }

  /* ── boot ───────────────────────────────────────────────────────────────── */
  function boot() {
    var entries = findProductImages();
    if (!entries.length) return;

    injectStyles();
    var name = getGarmentName();
    var category = detectCategory(name);

    for (var i = 0; i < entries.length; i++) {
      injectButton(entries[i], name, category);
    }
  }

  if (d.readyState === "loading") {
    d.addEventListener("DOMContentLoaded", function () {
      /* lazy-loaded imagery: give natural sizes a beat to resolve, then a
         second pass for anything the load event brings in */
      boot();
      w.addEventListener("load", boot);
    });
  } else {
    boot();
    if (d.readyState !== "complete") w.addEventListener("load", boot);
  }
})(window, document);
