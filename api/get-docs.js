/* ════════════════════════════════════════════════════════════════════
   POST /api/get-docs — server-gated implementation guide.

   The guide's markup lives here, on the server, and is only ever sent
   over the wire after the passcode checks out. Nothing about it is in
   the public bundle: view-source / devtools / curl on index.html show
   an empty <div id="docs-secure-viewport">.

   Scope of the protection, stated plainly: this stops UNAUTHORIZED
   people from getting the guide. It cannot stop an AUTHORIZED reader
   from copying what they were just handed — once the passcode is
   correct, the HTML is in their browser and it's theirs to read. That
   is the ceiling for any web-delivered content, and no client-side
   trick raises it.

   Setup: set DOCS_PASSCODE in Vercel → Project → Settings →
   Environment Variables (all environments), then redeploy. Rotating
   the code is a one-value change here — no frontend deploy needed.
   ════════════════════════════════════════════════════════════════════ */

const crypto = require('crypto');

/* ── Constant-time compare ────────────────────────────────────────
   timingSafeEqual throws on length mismatch — and the lengths alone
   would leak the passcode's length. Hashing both sides to a fixed
   32 bytes first sidesteps both problems. */
function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a), 'utf8').digest();
  const hb = crypto.createHash('sha256').update(String(b), 'utf8').digest();
  return crypto.timingSafeEqual(ha, hb);
}

/* ── Best-effort brute-force limiter ──────────────────────────────
   IMPORTANT / read before trusting this: serverless instances are
   ephemeral and scale horizontally, so this in-memory Map is NOT a
   reliable limiter. It resets on cold start and is not shared between
   concurrent instances — a determined attacker spraying requests can
   land on fresh instances and skate past it. It raises the cost of
   casual guessing; it is not a real control.

   For an actual limiter, back it with shared state (Vercel KV /
   Upstash Redis, keyed the same way) or put Vercel's WAF in front of
   this route. vercel.json cannot rate-limit — it only sets headers/
   routes, so there is no config-only version of this. */
const attempts = new Map();
const MAX_ATTEMPTS = 5;
const BLOCK_MS = 15 * 60 * 1000;
const WINDOW_MS = 15 * 60 * 1000;

function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length) return fwd.split(',')[0].trim();
  return req.socket?.remoteAddress || 'unknown';
}

function checkRate(ip) {
  const now = Date.now();
  const rec = attempts.get(ip);
  if (!rec) return { blocked: false };
  if (rec.blockedUntil && rec.blockedUntil > now) {
    return { blocked: true, retryAfter: Math.ceil((rec.blockedUntil - now) / 1000) };
  }
  if (rec.blockedUntil && rec.blockedUntil <= now) {
    attempts.delete(ip);                       // block expired — clean slate
    return { blocked: false };
  }
  if (now - rec.firstAt > WINDOW_MS) {
    attempts.delete(ip);                       // window rolled over
    return { blocked: false };
  }
  return { blocked: false };
}

function recordFailure(ip) {
  const now = Date.now();
  const rec = attempts.get(ip) || { count: 0, firstAt: now };
  rec.count += 1;
  if (rec.count >= MAX_ATTEMPTS) rec.blockedUntil = now + BLOCK_MS;
  attempts.set(ip, rec);
}

/* Opportunistic sweep so the Map can't grow without bound on a
   long-lived warm instance. */
function sweep() {
  const now = Date.now();
  for (const [ip, rec] of attempts) {
    const dead = (rec.blockedUntil && rec.blockedUntil <= now) ||
                 (!rec.blockedUntil && now - rec.firstAt > WINDOW_MS);
    if (dead) attempts.delete(ip);
  }
}

/* ── Origin / Fetch-Metadata check ────────────────────────────────
   Read this before trusting it: Origin, Referer, and Sec-Fetch-* are
   all just request headers. A real browser making a same-origin
   fetch() cannot forge them — Sec-Fetch-Site in particular is set by
   the browser itself and page JS has no way to override it, which is
   what makes it a meaningful signal against a malicious THIRD-PARTY
   WEBSITE trying to call this endpoint from a visitor's browser.

   It does NOT stop curl or Postman, and the ask to reject those
   outright can't be met by header inspection — curl sets whatever
   headers you tell it to (`curl -H "Sec-Fetch-Site: same-origin"`
   defeats this completely). Distinguishing "a script pretending to be
   a browser" from "a browser" is not a solvable problem at the HTTP
   layer; it needs something like a signed session/CSRF token issued
   by a page the script can't have loaded. This check is real
   defense-in-depth against cross-site abuse, not a bot wall. */
function allowedOrigins() {
  const fromEnv = (process.env.ALLOWED_ORIGIN || '')
    .split(',').map((s) => s.trim()).filter(Boolean);
  const list = fromEnv.length ? fromEnv : ['https://platform.pear-ai.io'];
  // Trust this deployment's own URL too, so preview/branch deploys aren't
  // locked out without needing a matching env var set on every branch.
  if (process.env.VERCEL_URL) list.push('https://' + process.env.VERCEL_URL);
  return list;
}

function passesOriginCheck(req) {
  const secFetchSite = req.headers['sec-fetch-site'];
  const origin = req.headers['origin'];
  const referer = req.headers['referer'];

  // Strong signal, browser-enforced: trust it when present.
  if (secFetchSite) return secFetchSite === 'same-origin';

  // No Sec-Fetch-Site — an older browser, or an extension stripped it.
  // Fall back to Origin, then Referer. Both are attacker-controlled for
  // a non-browser client, so this branch is soft, not a real barrier.
  const allowed = allowedOrigins();
  if (origin) return allowed.includes(origin);
  if (referer) return allowed.some((o) => referer.startsWith(o));

  // No signal at all is what a bare curl/Postman request looks like —
  // reject it, understanding a spoofed header sails right past this.
  return false;
}

/* ════════════════════════════════════════════════════════════════════
   THE GUIDE — everything below is what gets sent on success.

   LOCALISATION: the guide ships ONE copy of the markup carrying Hebrew
   defaults plus data-i18n / data-i18n-html keys. The client translates
   it on arrival — index.html's mountDocs() calls PearI18n.apply() on the
   injected subtree — so this endpoint stays language-agnostic and its
   response contract does not change. The English copy for every key
   below lives in i18n.js under the `guide.*` namespace; adding a string
   here means adding the same key there, in both languages.

   Deliberately NOT done here: reading Accept-Language or a ?lang= param
   and returning pre-translated HTML. That would make the response vary
   by request while the route sends `Cache-Control: no-store` and is
   gated on a passcode — extra server-side surface for something the
   client already does correctly for the rest of the page.
   ════════════════════════════════════════════════════════════════════ */
const GUIDE_HTML = `
<div class="pa-guide">

  <!-- ── 01 · Requirements ── -->
  <section>
    <div class="pa-guide__head">
      <span class="pa-guide__index">01</span>
      <h2 class="pa-guide__title" data-i18n="guide.reqTitle">הקדמה ודרישות מערכת</h2>
    </div>
    <div class="pa-panel">
      <div class="pa-panel__pad">
        <p class="pa-panel__lede" data-i18n="guide.reqBody">
          הוויג'ט הוא סקריפט JavaScript קל-משקל שנטען אסינכרונית ואינו משפיע על מהירות האתר.
          אין תלות בפלטפורמה — הוא עובד עם כל פלטפורמות האיקומרס:
        </p>
        <div class="pa-chips">
          <span>Shopify</span>
          <span>WooCommerce</span>
          <span>Magento</span>
          <span data-i18n="guide.reqCustom">Custom / פיתוח מותאם</span>
        </div>
      </div>
    </div>
  </section>

  <!-- ── 02 · Steps + code blocks ──
       Each step is rail + card. The rail's connector is a flex child, so
       it fills whatever height the card beside it ends up being — the
       three cards are different heights in every language and there is
       nothing here to re-tune when the copy changes. -->
  <section>
    <div class="pa-guide__head">
      <span class="pa-guide__index">02</span>
      <h2 class="pa-guide__title" data-i18n="guide.stepsTitle">שלבי ההטמעה</h2>
    </div>

    <div class="pa-steps">

      <div class="pa-step">
        <div class="pa-step__rail" aria-hidden="true">
          <span class="pa-step__num">1</span>
          <span class="pa-step__line"></span>
        </div>
        <div class="pa-step__body pa-panel">
          <h3 class="pa-step__title" data-i18n="guide.step1Title">שלב 1 · הוספת סקריפט המערכת (CDN)</h3>
          <p class="pa-step__note" data-i18n-html="guide.step1Body">הדביקו את השורה הבאה לפני תג <code dir="ltr">&lt;/body&gt;</code> — פעם אחת, בכל עמודי המוצר.</p>
        <div class="pa-code">
          <div class="pa-code__bar" dir="ltr">
            <span class="pa-code__dots" aria-hidden="true"><i></i><i></i><i></i></span>
            <span class="pa-code__file">index.html</span>
            <button type="button" class="copy-btn pa-guide__copy" data-copy="snippet-cdn">
              <svg class="copy-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/></svg>
              <svg class="check-icon hidden" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>
              <span class="copy-label">Copy</span>
            </button>
          </div>
          <pre class="pa-code__pre code-scroll"><code id="snippet-cdn"><span class="text-slate-500">&lt;!-- PEAR Virtual Try-On SDK --&gt;</span>
<span class="text-sky-300">&lt;script</span> <span class="text-emerald-300">src</span><span class="text-slate-400">=</span><span class="text-amber-200">"https://cdn.pear-tryon.com/sdk/v2/widget.js"</span> <span class="text-emerald-300">async</span><span class="text-sky-300">&gt;&lt;/script&gt;</span></code></pre>
        </div>
        </div>
      </div>

      <div class="pa-step">
        <div class="pa-step__rail" aria-hidden="true">
          <span class="pa-step__num">2</span>
          <span class="pa-step__line"></span>
        </div>
        <div class="pa-step__body pa-panel">
          <h3 class="pa-step__title" data-i18n="guide.step2Title">שלב 2 · מיקום כפתור המדידה בדף המוצר</h3>
          <p class="pa-step__note" data-i18n="guide.step2Body">הניחו את הקונטיינר בכל מקום בעמוד המוצר — לרוב מתחת לבורר המידות. הוויג'ט יעצב את עצמו בהתאם למקום.</p>
        <div class="pa-code">
          <div class="pa-code__bar" dir="ltr">
            <span class="pa-code__dots" aria-hidden="true"><i></i><i></i><i></i></span>
            <span class="pa-code__file">product-page.html</span>
            <button type="button" class="copy-btn pa-guide__copy" data-copy="snippet-container">
              <svg class="copy-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/></svg>
              <svg class="check-icon hidden" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>
              <span class="copy-label">Copy</span>
            </button>
          </div>
          <pre class="pa-code__pre code-scroll"><code id="snippet-container"><span class="text-sky-300">&lt;div</span>
  <span class="text-emerald-300">id</span><span class="text-slate-400">=</span><span class="text-amber-200">"pear-widget-container"</span>
  <span class="text-emerald-300">data-product-id</span><span class="text-slate-400">=</span><span class="text-amber-200">"12345"</span>
  <span class="text-emerald-300">data-store-id</span><span class="text-slate-400">=</span><span class="text-amber-200">"YOUR_STORE_ID"</span><span class="text-sky-300">&gt;
&lt;/div&gt;</span></code></pre>
        </div>
        </div>
      </div>

      <div class="pa-step">
        <div class="pa-step__rail" aria-hidden="true">
          <span class="pa-step__num">3</span>
        </div>
        <div class="pa-step__body pa-panel">
          <h3 class="pa-step__title" data-i18n="guide.step3Title">שלב 3 · אתחול והגדרות מותאמות אישית</h3>
          <p class="pa-step__note" data-i18n="guide.step3Body">שליטה מלאה על שפה, ערכת נושא, טקסט הכפתור ו-callbacks — הכל מאובייקט קונפיגורציה אחד.</p>
        <div class="pa-code">
          <div class="pa-code__bar" dir="ltr">
            <span class="pa-code__dots" aria-hidden="true"><i></i><i></i><i></i></span>
            <span class="pa-code__file">pear-init.js</span>
            <button type="button" class="copy-btn pa-guide__copy" data-copy="snippet-init">
              <svg class="copy-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/></svg>
              <svg class="check-icon hidden" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>
              <span class="copy-label">Copy</span>
            </button>
          </div>
          <pre class="pa-code__pre code-scroll"><code id="snippet-init"><span class="text-slate-300">window</span><span class="text-slate-400">.</span><span class="text-slate-300">PearWidget</span><span class="text-slate-400">.</span><span class="text-sky-300">init</span><span class="text-slate-400">({</span>
  <span class="text-emerald-300">storeId</span><span class="text-slate-400">:</span> <span class="text-amber-200">'YOUR_STORE_ID'</span><span class="text-slate-400">,</span>
  <span class="text-emerald-300">theme</span><span class="text-slate-400">:</span> <span class="text-amber-200">'light'</span><span class="text-slate-400">,</span>          <span class="text-slate-500">// 'light' | 'dark'</span>
  <span class="text-emerald-300">locale</span><span class="text-slate-400">:</span> <span class="text-amber-200" data-i18n="guide.snipLocale">'he'</span><span class="text-slate-400">,</span>
  <span class="text-emerald-300">buttonText</span><span class="text-slate-400">:</span> <span class="text-amber-200" data-i18n="guide.snipButton">'מדוד עכשיו עם AI'</span><span class="text-slate-400">,</span>

  <span class="text-slate-500" data-i18n="guide.snipComment">// נקרא כשהאלגוריתם מסיים לחשב מידה מומלצת</span>
  <span class="text-sky-300">onSizeRecommended</span><span class="text-slate-400">:</span> <span class="text-slate-400">(</span><span class="text-slate-300">result</span><span class="text-slate-400">) =&gt; {</span>
    <span class="text-slate-300">console</span><span class="text-slate-400">.</span><span class="text-sky-300">log</span><span class="text-slate-400">(</span><span class="text-amber-200" data-i18n="guide.snipLog">'המידה המומלצת:'</span><span class="text-slate-400">,</span> <span class="text-slate-300">result</span><span class="text-slate-400">.</span><span class="text-slate-300">size</span><span class="text-slate-400">);</span>
  <span class="text-slate-400">},</span>
<span class="text-slate-400">});</span></code></pre>
        </div>
        </div>
      </div>

    </div>
  </section>

  <!-- Dev-help helper card -->
  <section>
    <div class="pa-guide__help">
      <div class="pa-guide__help-copy">
        <h3 data-i18n="guide.helpTitle">צריכים עזרה טכנית בהטמעה?</h3>
        <!-- data-i18n-HTML, not data-i18n: the copy carries the brand
             name and every "PEAR" on the site is wrapped in a span. -->
        <p data-i18n-html="guide.helpBody">צוות הפיתוח של <span class="brand-pear">PEAR</span> זמין לעזור לכם לחבר את הווידג'ט לחנות שלכם במהירות ובקלות.</p>
      </div>
      <button type="button" class="pa-btn pa-btn--pear group" data-scroll="contact-section" data-view="contact" data-prefill="integration">
        <span data-i18n="guide.helpCta">דברו איתנו עכשיו</span>
        <!-- The glyph flips with the language; the hover nudge that moves
             it is corrected for LTR by a rule in index.html's style block. -->
        <span class="inline-block transition-transform duration-300 group-hover:-translate-x-1" data-i18n="guide.helpArrow">←</span>
      </button>
    </div>
  </section>

  <!-- Support note -->
  <section>
    <div class="pa-guide__note">
      <b aria-hidden="true">💡</b>
      <p data-i18n-html="guide.note">
        אין לכם עדיין <code dir="ltr">STORE_ID</code>?
        <a href="mailto:pearytrank@gmail.com">צרו קשר</a>
        ונקים לכם חשבון תוך יום עסקים.
      </p>
    </div>
  </section>
</div>
`;

module.exports = (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  // Never let a proxy or the browser cache an auth-gated response.
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');

  if (!passesOriginCheck(req)) {
    // Doesn't touch the rate limiter — that budget is reserved for actual
    // passcode guesses, not "wrong client type" rejections.
    return res.status(403).json({ error: 'forbidden' });
  }

  const expected = process.env.DOCS_PASSCODE;
  if (!expected) {
    // Fail closed. A missing env var must never mean "let everyone in".
    console.error('[get-docs] DOCS_PASSCODE is not set — refusing all requests.');
    return res.status(500).json({ error: 'server_misconfigured' });
  }

  const ip = clientIp(req);
  const rate = checkRate(ip);
  if (rate.blocked) {
    res.setHeader('Retry-After', String(rate.retryAfter));
    return res.status(429).json({ error: 'too_many_attempts', retry_after: rate.retryAfter });
  }

  // Vercel parses JSON bodies for us, but be tolerant of a raw string.
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  const passcode = body && typeof body.passcode === 'string' ? body.passcode : '';

  if (!passcode || !safeEqual(passcode, expected)) {
    recordFailure(ip);
    sweep();
    // 403 with nothing to learn from: no hint about length, format, or
    // how close the guess was.
    return res.status(403).json({ error: 'forbidden' });
  }

  attempts.delete(ip);                          // success clears the counter
  sweep();
  return res.status(200).json({ html: GUIDE_HTML });
};
