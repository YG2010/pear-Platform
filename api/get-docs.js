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
  const list = fromEnv.length ? fromEnv : ['https://pear-pi.vercel.app'];
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
   ════════════════════════════════════════════════════════════════════ */
const GUIDE_HTML = `
<div class="max-w-3xl mx-auto px-5 sm:px-8 py-14 sm:py-16 space-y-14">

  <!-- ── 01 · Requirements ── -->
  <section>
    <div class="flex items-center gap-3 mb-5">
      <span class="font-mono text-xs font-bold text-pear-600 bg-pear-50 border border-pear-100 rounded-md px-2 py-1">01</span>
      <h2 class="text-xl sm:text-2xl font-extrabold text-slate-900 tracking-tight">הקדמה ודרישות מערכת</h2>
    </div>
    <div class="rounded-2xl glass p-7">
      <p class="text-slate-600 mb-6">
        הוויג'ט הוא סקריפט JavaScript קל-משקל שנטען אסינכרונית ואינו משפיע על מהירות האתר.
        אין תלות בפלטפורמה — הוא עובד עם כל פלטפורמות האיקומרס:
      </p>
      <div class="flex flex-wrap gap-2">
        <span class="font-mono text-xs px-3 py-1.5 rounded-lg bg-slate-50 border border-slate-200 text-slate-600">Shopify</span>
        <span class="font-mono text-xs px-3 py-1.5 rounded-lg bg-slate-50 border border-slate-200 text-slate-600">WooCommerce</span>
        <span class="font-mono text-xs px-3 py-1.5 rounded-lg bg-slate-50 border border-slate-200 text-slate-600">Magento</span>
        <span class="font-mono text-xs px-3 py-1.5 rounded-lg bg-slate-50 border border-slate-200 text-slate-600">Custom / פיתוח מותאם</span>
      </div>
    </div>
  </section>

  <!-- ── 02 · Steps + code blocks ── -->
  <section>
    <div class="flex items-center gap-3 mb-5">
      <span class="font-mono text-xs font-bold text-pear-600 bg-pear-50 border border-pear-100 rounded-md px-2 py-1">02</span>
      <h2 class="text-xl sm:text-2xl font-extrabold text-slate-900 tracking-tight">שלבי ההטמעה</h2>
    </div>

    <div>
      <!-- Step 1: CDN -->
      <div class="relative flex gap-5">
        <div class="flex flex-col items-center shrink-0">
          <div class="w-10 h-10 rounded-full bg-gradient-to-br from-pear-400 to-pear-600 text-white font-mono font-bold text-sm flex items-center justify-center shadow-[0_0_0_4px_rgb(16_185_129/0.12),0_8px_20px_-6px_rgb(16_185_129/0.55)]">1</div>
          <div class="w-px flex-1 bg-gradient-to-b from-pear-400/50 to-transparent mt-2 mb-1"></div>
        </div>
        <div class="flex-1 min-w-0 pb-8">
          <div class="rounded-2xl glass overflow-hidden">
            <div class="p-7 pb-5">
              <h3 class="font-bold text-slate-900 text-lg mb-1.5">שלב 1 · הוספת סקריפט המערכת (CDN)</h3>
              <p class="text-sm text-slate-500">הדביקו את השורה הבאה לפני תג <code class="font-mono text-xs bg-slate-100 border border-slate-200 rounded px-1.5 py-0.5 text-slate-700" dir="ltr">&lt;/body&gt;</code> — פעם אחת, בכל עמודי המוצר.</p>
            </div>
            <div class="mx-7 mb-7 rounded-xl overflow-hidden border border-white/5 bg-[#0d1117] shadow-[0_20px_50px_-24px_rgb(0_0_0/0.6)]">
              <div class="flex items-center gap-4 px-4 py-3 bg-[#161b22] border-b border-white/5" dir="ltr">
                <div class="flex items-center gap-1.5" aria-hidden="true">
                  <span class="w-3 h-3 rounded-full bg-[#ff5f56]"></span>
                  <span class="w-3 h-3 rounded-full bg-[#ffbd2e]"></span>
                  <span class="w-3 h-3 rounded-full bg-[#27c93f]"></span>
                </div>
                <span class="font-mono text-[11px] text-slate-400 tracking-wider">index.html</span>
                <button class="copy-btn group ml-auto inline-flex items-center gap-1.5 font-mono text-[11px] font-semibold text-slate-300 bg-white/5 hover:bg-white/10 border border-white/10 rounded-md px-3 py-1.5 transition-colors" data-copy="snippet-cdn">
                  <svg class="copy-icon w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/></svg>
                  <svg class="check-icon hidden w-3.5 h-3.5 text-pear-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>
                  <span class="copy-label">Copy</span>
                </button>
              </div>
              <pre class="code-scroll p-5 text-[13px] leading-relaxed font-mono"><code id="snippet-cdn"><span class="text-slate-500">&lt;!-- PEAR Virtual Try-On SDK --&gt;</span>
<span class="text-sky-300">&lt;script</span> <span class="text-emerald-300">src</span><span class="text-slate-400">=</span><span class="text-amber-200">"https://cdn.pear-tryon.com/sdk/v2/widget.js"</span> <span class="text-emerald-300">async</span><span class="text-sky-300">&gt;&lt;/script&gt;</span></code></pre>
            </div>
          </div>
        </div>
      </div>

      <!-- Step 2: container -->
      <div class="relative flex gap-5">
        <div class="flex flex-col items-center shrink-0">
          <div class="w-10 h-10 rounded-full bg-gradient-to-br from-pear-400 to-pear-600 text-white font-mono font-bold text-sm flex items-center justify-center shadow-[0_0_0_4px_rgb(16_185_129/0.12),0_8px_20px_-6px_rgb(16_185_129/0.55)]">2</div>
          <div class="w-px flex-1 bg-gradient-to-b from-pear-400/50 to-transparent mt-2 mb-1"></div>
        </div>
        <div class="flex-1 min-w-0 pb-8">
          <div class="rounded-2xl glass overflow-hidden">
            <div class="p-7 pb-5">
              <h3 class="font-bold text-slate-900 text-lg mb-1.5">שלב 2 · מיקום כפתור המדידה בדף המוצר</h3>
              <p class="text-sm text-slate-500">הניחו את הקונטיינר בכל מקום בעמוד המוצר — לרוב מתחת לבורר המידות. הוויג'ט יעצב את עצמו בהתאם למקום.</p>
            </div>
            <div class="mx-7 mb-7 rounded-xl overflow-hidden border border-white/5 bg-[#0d1117] shadow-[0_20px_50px_-24px_rgb(0_0_0/0.6)]">
              <div class="flex items-center gap-4 px-4 py-3 bg-[#161b22] border-b border-white/5" dir="ltr">
                <div class="flex items-center gap-1.5" aria-hidden="true">
                  <span class="w-3 h-3 rounded-full bg-[#ff5f56]"></span>
                  <span class="w-3 h-3 rounded-full bg-[#ffbd2e]"></span>
                  <span class="w-3 h-3 rounded-full bg-[#27c93f]"></span>
                </div>
                <span class="font-mono text-[11px] text-slate-400 tracking-wider">product-page.html</span>
                <button class="copy-btn group ml-auto inline-flex items-center gap-1.5 font-mono text-[11px] font-semibold text-slate-300 bg-white/5 hover:bg-white/10 border border-white/10 rounded-md px-3 py-1.5 transition-colors" data-copy="snippet-container">
                  <svg class="copy-icon w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/></svg>
                  <svg class="check-icon hidden w-3.5 h-3.5 text-pear-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>
                  <span class="copy-label">Copy</span>
                </button>
              </div>
              <pre class="code-scroll p-5 text-[13px] leading-relaxed font-mono"><code id="snippet-container"><span class="text-sky-300">&lt;div</span>
  <span class="text-emerald-300">id</span><span class="text-slate-400">=</span><span class="text-amber-200">"pear-widget-container"</span>
  <span class="text-emerald-300">data-product-id</span><span class="text-slate-400">=</span><span class="text-amber-200">"12345"</span>
  <span class="text-emerald-300">data-store-id</span><span class="text-slate-400">=</span><span class="text-amber-200">"YOUR_STORE_ID"</span><span class="text-sky-300">&gt;
&lt;/div&gt;</span></code></pre>
            </div>
          </div>
        </div>
      </div>

      <!-- Step 3: init -->
      <div class="relative flex gap-5">
        <div class="flex flex-col items-center shrink-0">
          <div class="w-10 h-10 rounded-full bg-gradient-to-br from-pear-400 to-pear-600 text-white font-mono font-bold text-sm flex items-center justify-center shadow-[0_0_0_4px_rgb(16_185_129/0.12),0_8px_20px_-6px_rgb(16_185_129/0.55)]">3</div>
        </div>
        <div class="flex-1 min-w-0">
          <div class="rounded-2xl glass overflow-hidden">
            <div class="p-7 pb-5">
              <h3 class="font-bold text-slate-900 text-lg mb-1.5">שלב 3 · אתחול והגדרות מותאמות אישית</h3>
              <p class="text-sm text-slate-500">שליטה מלאה על שפה, ערכת נושא, טקסט הכפתור ו-callbacks — הכל מאובייקט קונפיגורציה אחד.</p>
            </div>
            <div class="mx-7 mb-7 rounded-xl overflow-hidden border border-white/5 bg-[#0d1117] shadow-[0_20px_50px_-24px_rgb(0_0_0/0.6)]">
              <div class="flex items-center gap-4 px-4 py-3 bg-[#161b22] border-b border-white/5" dir="ltr">
                <div class="flex items-center gap-1.5" aria-hidden="true">
                  <span class="w-3 h-3 rounded-full bg-[#ff5f56]"></span>
                  <span class="w-3 h-3 rounded-full bg-[#ffbd2e]"></span>
                  <span class="w-3 h-3 rounded-full bg-[#27c93f]"></span>
                </div>
                <span class="font-mono text-[11px] text-slate-400 tracking-wider">pear-init.js</span>
                <button class="copy-btn group ml-auto inline-flex items-center gap-1.5 font-mono text-[11px] font-semibold text-slate-300 bg-white/5 hover:bg-white/10 border border-white/10 rounded-md px-3 py-1.5 transition-colors" data-copy="snippet-init">
                  <svg class="copy-icon w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/></svg>
                  <svg class="check-icon hidden w-3.5 h-3.5 text-pear-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>
                  <span class="copy-label">Copy</span>
                </button>
              </div>
              <pre class="code-scroll p-5 text-[13px] leading-relaxed font-mono"><code id="snippet-init"><span class="text-slate-300">window</span><span class="text-slate-400">.</span><span class="text-slate-300">PearWidget</span><span class="text-slate-400">.</span><span class="text-sky-300">init</span><span class="text-slate-400">({</span>
  <span class="text-emerald-300">storeId</span><span class="text-slate-400">:</span> <span class="text-amber-200">'YOUR_STORE_ID'</span><span class="text-slate-400">,</span>
  <span class="text-emerald-300">theme</span><span class="text-slate-400">:</span> <span class="text-amber-200">'light'</span><span class="text-slate-400">,</span>          <span class="text-slate-500">// 'light' | 'dark'</span>
  <span class="text-emerald-300">locale</span><span class="text-slate-400">:</span> <span class="text-amber-200">'he'</span><span class="text-slate-400">,</span>
  <span class="text-emerald-300">buttonText</span><span class="text-slate-400">:</span> <span class="text-amber-200">'מדוד עכשיו עם AI'</span><span class="text-slate-400">,</span>

  <span class="text-slate-500">// נקרא כשהאלגוריתם מסיים לחשב מידה מומלצת</span>
  <span class="text-sky-300">onSizeRecommended</span><span class="text-slate-400">:</span> <span class="text-slate-400">(</span><span class="text-slate-300">result</span><span class="text-slate-400">) =&gt; {</span>
    <span class="text-slate-300">console</span><span class="text-slate-400">.</span><span class="text-sky-300">log</span><span class="text-slate-400">(</span><span class="text-amber-200">'המידה המומלצת:'</span><span class="text-slate-400">,</span> <span class="text-slate-300">result</span><span class="text-slate-400">.</span><span class="text-slate-300">size</span><span class="text-slate-400">);</span>
  <span class="text-slate-400">},</span>
<span class="text-slate-400">});</span></code></pre>
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>

  <!-- Dev-help helper card -->
  <section>
    <div class="relative overflow-hidden rounded-2xl glass-dark text-white px-7 py-6 flex flex-col sm:flex-row sm:items-center gap-5">
      <div class="pointer-events-none absolute inset-0" aria-hidden="true"
           style="background:
             radial-gradient(420px 220px at 15% 0%, rgb(16 185 129 / .22), transparent 65%),
             radial-gradient(360px 200px at 100% 100%, rgb(56 189 248 / .16), transparent 65%);"></div>
      <div class="relative flex-1">
        <h3 class="font-bold text-lg mb-1">צריכים עזרה טכנית בהטמעה?</h3>
        <p class="text-sm text-slate-300 leading-relaxed">צוות הפיתוח של PEAR זמין לעזור לכם לחבר את הווידג'ט לחנות שלכם במהירות ובקלות.</p>
      </div>
      <button data-scroll="contact-section" data-view="contact" data-prefill="integration"
         class="group relative shrink-0 cursor-pointer inline-flex items-center justify-center gap-2 rounded-xl bg-pear-600 text-white font-bold px-6 py-3 shadow-btn hover:bg-pear-700 hover:-translate-y-0.5 transition-all whitespace-nowrap">
        <span>דברו איתנו עכשיו</span>
        <span class="inline-block transition-transform duration-300 group-hover:-translate-x-1">←</span>
      </button>
    </div>
  </section>

  <!-- Support note -->
  <section>
    <div class="rounded-2xl bg-pear-50 border border-pear-100 px-7 py-6 flex items-start gap-4">
      <span class="text-xl leading-none mt-0.5">💡</span>
      <p class="text-sm text-slate-600 leading-relaxed">
        אין לכם עדיין <span class="font-mono text-xs bg-white border border-pear-100 rounded px-1.5 py-0.5" dir="ltr">STORE_ID</span>?
        <a href="mailto:pearytrank@gmail.com" class="font-semibold text-pear-700 underline underline-offset-2 hover:text-pear-600">צרו קשר</a>
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
