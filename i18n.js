/* ════════════════════════════════════════════════════════════════════
   PEAR · i18n — automatic Hebrew / English localisation
   ════════════════════════════════════════════════════════════════════

   LOADING: this file is a CLASSIC, RENDER-BLOCKING <script> in <head>,
   deliberately not defer/async. It has to run before the browser paints
   the body, because it sets <html lang> / <html dir> and swaps the
   document title + meta description. Deferring it would show a frame of
   Hebrew RTL layout to an English visitor.

   RESOLUTION ORDER (first hit wins):
     1. ?lang=he|en in the URL — what the hreflang alternates point at,
        so a search engine landing on /?lang=en gets English markup with
        no guessing at all. Governs ONLY this page load; it is
        deliberately NOT written to localStorage (see LANG_KEY below for
        why that used to happen and what it broke).
     2. localStorage['app_lang'] — an explicit choice, written ONLY by an
        actual click on the navbar [data-set-lang] toggle. A visitor who
        picked a language is never overridden by anything below.
     3. localStorage['app_lang_geo'] — a cached country lookup (30 days),
        so only the very first visit ever pays for a network round trip.
     4. GEO_SOURCES, tried in order — country_code === 'IL' → Hebrew,
        everything else (US included) → English. ipapi.co is asked
        first; ip-api.com and ipinfo.io only get a request if the one
        before them failed, errored, or timed out. A single provider is
        not reliable enough on its own: VPNs and privacy extensions
        commonly block ipapi.co by name (it is a known entry on several
        tracker blocklists), and a visitor testing over a VPN in
        Incognito is exactly the visitor most likely to have both. Three
        independent providers falling over at once is far less likely
        than one. The three share ONE wall-clock budget (GEO_BUDGET_MS)
        rather than each getting a small fixed slot — VPN-routed traffic
        regularly adds real latency on top of a normal geo-IP round
        trip, and a too-tight per-provider timeout aborts a genuine,
        still-in-flight response before it can ever arrive.
     5. DEFAULT_LANG ('en') — used ONLY if every source in step 4 failed
        or the whole cascade ran out of budget. This does NOT consult
        navigator.language: an unresolved visitor is a safe default for
        an internationally-facing site, and OS/browser locale is not a
        reliable signal of WHERE someone is browsing from (that is the
        whole reason VPN testing exists). Hebrew is only ever reached
        through a confirmed 'IL' IP match (step 4) or a deliberate toggle
        click (step 2) — never inferred.

   THE CLOAK: steps 1–3 are synchronous, so the common case resolves
   before first paint with zero flicker and no cloak at all. Only a
   first-ever visit reaches step 4, which is async — for that case only,
   <html> gets .i18n-cloak (a CSS rule fades the body out) until the
   lookup settles or CLOAK_MAX_MS elapses, whichever comes first. The
   failsafe timer matters: it guarantees the page can never be left
   invisible by a hanging request — and CLOAK_MAX_MS is sized to
   comfortably exceed GEO_BUDGET_MS so it fires only once the whole
   cascade is genuinely exhausted, not while a real answer is still
   in flight (see the constants below for the exact numbers).

   SECURITY NOTE: values under the `html:` namespace are injected with
   innerHTML. Everything in DICT below is an author-written literal that
   ships with this file — never route visitor input or an API response
   through a `.html` key.
   ════════════════════════════════════════════════════════════════════ */
(function (window, document) {
  'use strict';

  /* ── Configuration ─────────────────────────────────────────────── */
  var SUPPORTED       = ['he', 'en'];
  var DEFAULT_LANG    = 'en';          // every country that isn't Israel
  var GEO_LANG        = 'he';          // …and the one that is
  var GEO_COUNTRY     = 'IL';
  var RTL_LANGS       = ['he'];

  var STAMP           = 'data-i18n-lang'; // language an element currently carries

  var LANG_KEY        = 'app_lang';      // explicit visitor choice
  var GEO_KEY         = 'app_lang_geo';  // cached auto-detection
  var GEO_TTL_MS      = 30 * 24 * 60 * 60 * 1000;

  /* Three independent IP-geolocation providers, tried in order until one
     answers. Each has its own response shape, hence its own `extract`.
     A provider that 400s, times out, CORS-blocks, or returns a body that
     `extract` can't make sense of is treated as a failure and the next
     one is tried immediately — see fromIpLookup().

     ip-api.com's free-tier JSON endpoint has historically not sent CORS
     headers for direct browser calls, so it may fail every time with an
     opaque network error depending on the visitor's browser. That is
     fine and deliberate: it costs one fast local failure, then falls
     through to ipinfo.io exactly like any other provider outage. It
     stays in the list because when it DOES answer it is one more
     independent source between a visitor and the DEFAULT_LANG
     fallback. */
  var GEO_SOURCES = [
    {
      label: 'ipapi.co',
      url: 'https://ipapi.co/json/',
      /* Rate limiting comes back as HTTP 200 + {"error":true}, so `ok`
         alone is not a strong enough success signal. */
      extract: function (data) {
        if (!data || data.error) throw new Error(data && data.reason || 'error');
        return data.country_code;
      }
    },
    {
      label: 'ip-api.com',
      url: 'https://ip-api.com/json',
      extract: function (data) {
        if (!data || data.status !== 'success') throw new Error(data && data.message || 'error');
        return data.countryCode;
      }
    },
    {
      label: 'ipinfo.io',
      url: 'https://ipinfo.io/json',
      extract: function (data) {
        if (!data || !data.country) throw new Error('no country field');
        return data.country;
      }
    }
  ];

  /* ONE shared wall-clock budget for the whole GEO_SOURCES cascade —
     see fromIpLookup(). The first attempt gets nearly the entire budget
     (so a slow-but-genuine VPN response has real room to land instead
     of being aborted); if it fails outright rather than timing out, the
     next attempt still gets almost all of it too. Only a provider that
     actually burns time via its own timeout squeezes what is left for
     the next one.

     700ms (the previous per-provider figure) was diagnosed in production
     as too aggressive: every one of the three providers was failing with
     "signal is aborted without reason" — the fetches were being aborted
     before a real, working response could arrive, not because anything
     was actually down. 4 seconds is generous enough to absorb typical
     VPN-added latency on top of a normal geo-IP round trip. */
  var GEO_BUDGET_MS   = 4000;
  /* Comfortably above GEO_BUDGET_MS so the cloak's failsafe fires only
     once the cascade has genuinely exhausted its budget, plus headroom
     for normal JS/timer scheduling slop — not a moment before a real
     answer could still land. */
  var CLOAK_MAX_MS    = 4600;   // hard ceiling on the first-visit cloak

  var SITE_ORIGIN     = 'https://platform.pear-ai.io';
  var OG_LOCALE       = { he: 'he_IL', en: 'en_US' };

  /* ════════════════════════════════════════════════════════════════
     DICTIONARY · one entry per language, flat dotted keys.

     Markup keys live under `html:` and are applied with innerHTML —
     that is what lets a sentence keep its inline <span class="brand-pear">
     or coloured emphasis while still being one translatable unit.
     Plain keys under `text:` are applied with textContent.
     ════════════════════════════════════════════════════════════════ */
  var DICT = {

    /* ──────────────────────────── HEBREW ──────────────────────────── */
    he: {
      /* — head / SEO — */
      'meta.title':              'PEAR Platform | PearVTON – מדידה וירטואלית ותא מדידה לאופנה',
      'meta.description':        'PEAR Platform (PearVTON): מדידה וירטואלית ותא מדידה וירטואלי מבוססי AI לחנויות אופנה אונליין. פחות החזרות, יותר המרות.',
      'meta.keywords':           'pear, pear platform, pearvton, תא מדידה וירטואלי, מדידה וירטואלית, מדידת בגדים אונליין, המלצת מידה, הפחתת החזרות, אופנה אונליין, virtual try-on',
      'meta.ogTitle':            'PEAR Platform | PearVTON – מדידה וירטואלית מבוססת AI',
      'meta.ogDescription':      'פלטפורמת מדידה ותא מדידה וירטואלי מבוססי AI לחנויות אופנה. פחות החזרות, קונים בטוחים יותר.',
      'meta.twitterTitle':       'PEAR Platform | PearVTON – מדידה וירטואלית לאופנה',
      'meta.twitterDescription': 'מדידה וירטואלית ותא מדידה לחנויות אופנה אונליין, מבוססי PearVTON.',
      'meta.jsonldDescription':  'PEAR Platform (PearVTON) – טכנולוגיית מדידה וירטואלית ותא מדידה מבוססי AI לחנויות אופנה אונליין ולהתאמת מידה בזמן אמת.',

      /* — accessibility labels — */
      'a11y.mainNav':       'ניווט ראשי',
      'a11y.langSwitch':    'בחירת שפה',
      'a11y.viewOverview':  'אודות המיזם והפתרון',
      'a11y.viewDocs':      'מדריך הטמעת הוויג\'ט',
      'a11y.viewContact':   'צור קשר',
      'a11y.heroVideo':     'הדגמת מדידה וירטואלית של PEAR — לולאה ללא קול',
      'a11y.demoVideo':     'סרטון הדגמה של PEAR',
      'a11y.vtonPause':     'השהיית ההדגמה',
      'a11y.vtonPlay':      'הפעלת ההדגמה',
      'a11y.directMeasure': 'מדידה וירטואלית חד-פעמית, ללא שלב הרשמה, פעם אחת בביקור',
      'a11y.fittingRoom':   'PEAR — מדידה וירטואלית חד-פעמית',
      'a11y.closeModal':    'סגירה',

      /* — navbar — */
      'nav.about':   'על המיזם',
      'nav.docs':    'מדריך הטמעה',
      'nav.contact': 'דברו איתנו',

      /* — scroll HUD chapters — */
      'hud.intro':      'פתיחה',
      'hud.playground': 'נסו בעצמכם',
      'hud.demo':       'הדגמה חיה',
      'hud.market':     'נתוני שוק',
      'hud.cta':        'סיום',

      /* — hero — */
      'hero.title':         '<span dir="ltr" class="block text-lg sm:text-xl font-bold text-pear-600 tracking-tight mb-2">PEAR Platform · AI Virtual Try-On &amp; Measurement</span>\n          הלקוחות שלכם מודדים\n          <span class="block mt-2 text-pear-600">בלי להגיע לחנות.</span>',
      'hero.sub':           '<span class="brand-pear">PEAR</span> מלביש את הבגד על הלקוח בזמן אמת, ממליץ מידה מדויקת ומוריד החזרות.\n          <span class="font-semibold text-slate-700"><br> מודדים בבית, קונים בביטחון.</span>',
      'hero.ctaPrimary':    '✨ נסו את הוויג\'ט האמיתי · 30 שניות',
      'hero.ctaSecondary':  '▶ איך זה עובד? ב-17 שניות',
      'hero.proof1':        'מחקרי שוק: <span class="font-bold text-slate-700">עד ~25% מהזמנות האופנה מוחזרות</span>',
      'hero.proof2':        'אי-התאמת מידה <span class="font-bold text-slate-700">סיבת ההחזרה מס\' 1</span>',
      'hero.proof3':        'הטמעה ב<span class="font-bold text-slate-700">שורת קוד אחת</span>',
      'hero.badgeSize':     'מידה מומלצת: <span class="font-mono text-pear-600">M</span>',
      'hero.badgeRealtime': 'התאמה בזמן אמת ✨',

      /* — live widget playground — */
      'play.eyebrow':      'Live Widget · בלי הרשמה',
      'play.title':        'זה הוויג\'ט האמיתי. ממש כאן.',
      'play.sub':          'כך זה נראה בדף מוצר: לחצו על "מדידה חד-פעמית מהירה" וקבלו מדידה וירטואלית אמיתית, בלי הרשמה.',
      'play.productAlt':   'חולצה בעיצוב PEAR Virtual Try-On, גזרת אוברסייז, בז\'',
      'play.productName':  'חולצת <span class="brand-pear">PEAR</span> · Virtual Try-On',
      'play.productMeta':  'בז\' · מידות S–XXL',
      'play.cta':          '⚡ מדידה חד-פעמית מהירה',
      'play.ctaNote':      'דילוג על שלב ההרשמה — ישר למדידה, שימוש אחד בכל ביקור.',
      'play.ctaUsed':      '✓ המדידה נוצלה לביקור הזה',
      'play.ctaUsedTitle': 'כבר בוצעה מדידה חד-פעמית בביקור הזה',
      'play.ctaLoading':   'טוען…',
      'play.loadError':    'לא הצלחנו לטעון את הוויג׳ט. נסו שוב בעוד רגע.',

      /* — demo band — */
      'demo.eyebrow': '17 שניות · לפני/אחרי',
      'demo.title':   'כך זה נראה ללקוח שלכם',
      'demo.sub':     'מהעמוד מוצר ועד תמונת לבוש — חוויה חלקה, ישירות בדפדפן, ללא אפליקציה.',

      /* — market research — */
      'market.eyebrow':      'נתוני שוק',
      'market.title':        'מה שמחקרי השוק מראים',
      'market.sub':          'הפער בין המסך למציאות עולה למותגי אופנה ביוקר — וזו בדיוק הבעיה ש-<span class="brand-pear">PEAR</span> נבנתה כדי לפתור.',
      'market.stat1':        'שיעור ההחזרות באופנה מקוונת מהגבוהים באיקומרס',
      'market.stat2':        'אי-התאמת מידה היא סיבת ההחזרה המובילה בהלבשה',
      'market.stat3':        'קונים מזמינים כמה מידות ומחזירים את העודף — ונועלים מלאי מבוקש',
      'market.potential':    '<span class="brand-pear">PEAR</span> הופכת את חוסר הוודאות הזה לביטחון:\n        <span class="text-pear-700 font-bold">מדידה חזותית מבוססת AI</span>\n        שמאפשרת לכל קונה לראות את הבגד על עצמו ולקבל את המידה המדויקת עוד לפני התשלום.',
      'market.potentialTag': 'הפוטנציאל · פחות החזרות · יותר המרות · קונים בטוחים',
      'market.footnote':     '* הנתונים לעיל מבוססים על מחקרי אופנה ואיקומרס מקובלים בתעשייה, לא על ביצועי לקוח.',

      /* — final CTA — */
      'cta.title':   'מוכנים להוריד את אחוז ההחזרות?',
      'cta.sub':     'שורת קוד אחת. חמש דקות. והלקוחות שלכם מודדים בבית.',
      'cta.primary': '✨ נסו את הוויג\'ט',
      'cta.docs':    'למדריך ההטמעה ←',
      'cta.contact': 'דברו איתנו 💬',

      /* — docs view + access gate — */
      'docs.title':             'מדריך הטמעת הוויג\'ט',
      'docs.sub':               'הטמעת הוויג\'ט של <span class="brand-pear">PEAR</span> לוקחת <span class="font-semibold text-slate-700">פחות מ-5 דקות</span> ולא דורשת\n        שינויים בארכיטקטורת האתר. שלושה שלבים והלקוחות שלכם מודדים.',
      'docs.gateTitle':         'המדריך נעול לקהל הרחב',
      'docs.gateSub':           'גישה למדריך ההטמעה הטכני ניתנת באישור ידני של צוות הפיתוח.',
      'docs.gatePlaceholder':   'קוד גישה',
      'docs.gateSubmit':        'אימות',
      'docs.gateChecking':      'בודק…',
      'docs.gateRequest':       'אין לכם קוד גישה? מלאו את הטופס למטה ונשלח לכם מיידית ←',
      'docs.errWrong':          'קוד שגוי — נסו שוב.',
      'docs.errNoRuntime':      'סביבת פיתוח: אין ריצת שרת. הריצו vercel dev במקום Live Server.',
      'docs.errNoPasscode':     'תקלת הגדרה בשרת: DOCS_PASSCODE אינו מוגדר.',
      'docs.errRateLimit':      'יותר מדי ניסיונות — נסו שוב בעוד 15 דקות.',

      /* — contact — */
      'contact.title':          'בואו נדבר',
      'contact.sub':            'שאלה על הטמעה, בקשת דמו למותג שלכם, או סתם רוצים להכיר?\n        מלאו את הטופס או פנו אלינו ישירות.',
      'contact.fieldName':      'שם מלא',
      'contact.phName':         'ישראל ישראלי',
      'contact.fieldEmail':     'אימייל',
      'contact.phEmail':        'you@brand.com',
      'contact.fieldPhone':     'טלפון',
      'contact.phPhone':        '050-1234567',
      'contact.fieldCompany':   'שם החברה',
      'contact.phCompany':      'שם המותג / החברה',
      'contact.fieldRole':      'תפקיד',
      'contact.phRole':         'למשל: מנהל/ת דיגיטל',
      'contact.fieldSubject':   'נושא',
      'contact.phSubject':      'למשל: בקשת דמו למותג אופנה',
      'contact.fieldMessage':   'הודעה',
      'contact.phMessage':      'ספרו לנו קצת על הפרויקט...',
      'contact.submit':         'שליחת הודעה',
      'contact.sending':        'שולח…',
      'contact.sent':           'נשלח בהצלחה ✓',
      'contact.toastSuccess':   'הודעתך נשלחה בהצלחה! נחזור אליכם בהקדם',
      'contact.toastError':     'השליחה נכשלה — נסו שוב או כתבו לנו ישירות למייל',
      'contact.defaultSubject': 'פנייה חדשה מאתר PEAR',
      'contact.directTitle':    'פנייה ישירה',
      'contact.directSub':      'מעדיפים לדבר ישירות? אנחנו זמינים באימייל.',
      'contact.teamNote':       'צוות <span class="brand-pear">PEAR</span> זמין לשאלות טכניות, הדגמות למותגים ותמיכה בהטמעה.',

      /* — footer — */
      'footer.rights': '© 2026 <span class="brand-pear">PEAR</span> Platform (pearvton) — Virtual Try-On · כל הזכויות שמורות',

      /* — toasts — */
      'toast.copied':     'הקוד הועתק ללוח ✓',
      'toast.copyFailed': 'ההעתקה נכשלה — העתיקו ידנית',

      /* — contact-form prefills (set by tagged CTAs) — */
      'prefill.integration.subject': 'עזרה בהטמעת PEAR באתר',
      'prefill.integration.message': 'היי, אני מנסה להטמיע את PEAR באתר שלי ואשמח לקבל עזרה קלה מהצוות הטכני שלכם.',
      'prefill.docsAccess.subject':  'בקשת גישה למדריך ההטמעה',
      'prefill.docsAccess.message':  '🔐 בקשת גישה למדריך ההטמעה\n\nהיי, אשמח לקבל קוד גישה למדריך ההטמעה הטכני של PEAR.\n\n(לאישור: השיבו לכתובת המייל הזו עם קוד הגישה)',
      'prefill.docsAccess.type':     'בקשת גישה למדריך ההטמעה 🔐',

      /* — the gated implementation guide (markup lives in api/get-docs.js) — */
      'guide.reqTitle':    'הקדמה ודרישות מערכת',
      'guide.reqBody':     'הוויג\'ט הוא סקריפט JavaScript קל-משקל שנטען אסינכרונית ואינו משפיע על מהירות האתר.\n        אין תלות בפלטפורמה — הוא עובד עם כל פלטפורמות האיקומרס:',
      'guide.reqCustom':   'Custom / פיתוח מותאם',
      'guide.stepsTitle':  'שלבי ההטמעה',
      'guide.step1Title':  'שלב 1 · הוספת סקריפט המערכת (CDN)',
      'guide.step1Body':   'הדביקו את השורה הבאה לפני תג <code class="font-mono text-xs bg-slate-100 border border-slate-200 rounded px-1.5 py-0.5 text-slate-700" dir="ltr">&lt;/body&gt;</code> — פעם אחת, בכל עמודי המוצר.',
      'guide.step2Title':  'שלב 2 · מיקום כפתור המדידה בדף המוצר',
      'guide.step2Body':   'הניחו את הקונטיינר בכל מקום בעמוד המוצר — לרוב מתחת לבורר המידות. הוויג\'ט יעצב את עצמו בהתאם למקום.',
      'guide.step3Title':  'שלב 3 · אתחול והגדרות מותאמות אישית',
      'guide.step3Body':   'שליטה מלאה על שפה, ערכת נושא, טקסט הכפתור ו-callbacks — הכל מאובייקט קונפיגורציה אחד.',
      'guide.snipLocale':  '\'he\'',
      'guide.snipButton':  '\'מדוד עכשיו עם AI\'',
      'guide.snipComment': '// נקרא כשהאלגוריתם מסיים לחשב מידה מומלצת',
      'guide.snipLog':     '\'המידה המומלצת:\'',
      'guide.helpTitle':   'צריכים עזרה טכנית בהטמעה?',
      'guide.helpBody':    'צוות הפיתוח של PEAR זמין לעזור לכם לחבר את הווידג\'ט לחנות שלכם במהירות ובקלות.',
      'guide.helpCta':     'דברו איתנו עכשיו',
      'guide.helpArrow':   '←',
      'guide.note':        'אין לכם עדיין <span class="font-mono text-xs bg-white border border-pear-100 rounded px-1.5 py-0.5" dir="ltr">STORE_ID</span>?\n        <a href="mailto:pearytrank@gmail.com" class="font-semibold text-pear-700 underline underline-offset-2 hover:text-pear-600">צרו קשר</a>\n        ונקים לכם חשבון תוך יום עסקים.'
    },

    /* ──────────────────────────── ENGLISH ─────────────────────────── */
    en: {
      /* — head / SEO — */
      'meta.title':              'PEAR Platform | PearVTON – Virtual Try-On & Measurement',
      'meta.description':        'PEAR Platform (PearVTON): AI-powered Virtual Try-On and Virtual Measurement for fashion e-commerce. Reduce returns, boost conversion.',
      'meta.keywords':           'pear, pear platform, pearvton, virtual try-on, virtual measurement, AI virtual try-on, size recommendation, reduce returns, fashion ecommerce',
      'meta.ogTitle':            'PEAR Platform | PearVTON – AI Virtual Try-On & Measurement',
      'meta.ogDescription':      'AI-powered Virtual Try-On and Virtual Measurement platform for fashion e-commerce. Fewer returns, more confident purchases.',
      'meta.twitterTitle':       'PEAR Platform | PearVTON – Virtual Try-On & Measurement',
      'meta.twitterDescription': 'AI Virtual Try-On & Virtual Measurement for fashion e-commerce, powered by PearVTON.',
      'meta.jsonldDescription':  'PEAR Platform (PearVTON) – AI Virtual Try-On and Virtual Measurement technology for fashion e-commerce and real-time sizing.',

      /* — accessibility labels — */
      'a11y.mainNav':       'Main navigation',
      'a11y.langSwitch':    'Choose language',
      'a11y.viewOverview':  'About the product and the solution',
      'a11y.viewDocs':      'Widget integration guide',
      'a11y.viewContact':   'Contact us',
      'a11y.heroVideo':     'PEAR virtual try-on demo — silent loop',
      'a11y.demoVideo':     'PEAR demo video',
      'a11y.vtonPause':     'Pause the demo',
      'a11y.vtonPlay':      'Play the demo',
      'a11y.directMeasure': 'One-time virtual measurement, no signup step, once per visit',
      'a11y.fittingRoom':   'PEAR — one-time virtual measurement',
      'a11y.closeModal':    'Close',

      /* — navbar — */
      'nav.about':   'About',
      'nav.docs':    'Integration guide',
      'nav.contact': 'Talk to us',

      /* — scroll HUD chapters — */
      'hud.intro':      'Intro',
      'hud.playground': 'Try it yourself',
      'hud.demo':       'Live demo',
      'hud.market':     'Market data',
      'hud.cta':        'Wrap-up',

      /* — hero — */
      'hero.title':         '<span dir="ltr" class="block text-lg sm:text-xl font-bold text-pear-600 tracking-tight mb-2">PEAR Platform · AI Virtual Try-On &amp; Measurement</span>\n          Your customers find their size\n          <span class="block mt-2 text-pear-600">without setting foot in a store.</span>',
      'hero.sub':           '<span class="brand-pear">PEAR</span> puts the garment on your shopper in real time, recommends their exact size and cuts returns.\n          <span class="font-semibold text-slate-700"><br> They measure at home and buy with confidence.</span>',
      'hero.ctaPrimary':    '✨ Try the real widget · 30 seconds',
      'hero.ctaSecondary':  '▶ How does it work? In 17 seconds',
      'hero.proof1':        'Market research: <span class="font-bold text-slate-700">up to ~25% of fashion orders come back</span>',
      'hero.proof2':        'Wrong size is the <span class="font-bold text-slate-700">#1 reason for returns</span>',
      'hero.proof3':        'Integrates in <span class="font-bold text-slate-700">a single line of code</span>',
      'hero.badgeSize':     'Recommended size: <span class="font-mono text-pear-600">M</span>',
      'hero.badgeRealtime': 'Real-time fit ✨',

      /* — live widget playground — */
      'play.eyebrow':      'Live Widget · no signup',
      'play.title':        'This is the real widget. Right here.',
      'play.sub':          'This is how it looks on a product page: tap "Quick one-time measurement" and get a real virtual measurement — no signup.',
      'play.productAlt':   'PEAR Virtual Try-On tee, oversized fit, beige',
      'play.productName':  '<span class="brand-pear">PEAR</span> tee · Virtual Try-On',
      'play.productMeta':  'Beige · sizes S–XXL',
      'play.cta':          '⚡ Quick one-time measurement',
      'play.ctaNote':      'Skips the signup step — straight to measuring, once per visit.',
      'play.ctaUsed':      '✓ Measurement already used this visit',
      'play.ctaUsedTitle': 'You have already used your one-time measurement on this visit',
      'play.ctaLoading':   'Loading…',
      'play.loadError':    'We could not load the widget. Please try again in a moment.',

      /* — demo band — */
      'demo.eyebrow': '17 seconds · before/after',
      'demo.title':   'Here is what your customer sees',
      'demo.sub':     'From the product page to a photo of them wearing it — one smooth flow, straight in the browser, no app.',

      /* — market research — */
      'market.eyebrow':      'Market data',
      'market.title':        'What the market research shows',
      'market.sub':          'The gap between the screen and reality costs fashion brands dearly — and that is exactly the problem <span class="brand-pear">PEAR</span> was built to solve.',
      'market.stat1':        'Online fashion return rates are among the highest in e-commerce',
      'market.stat2':        'Wrong size is the leading reason apparel gets sent back',
      'market.stat3':        'Shoppers order several sizes and return the rest — locking up in-demand stock',
      'market.potential':    '<span class="brand-pear">PEAR</span> turns that uncertainty into confidence:\n        <span class="text-pear-700 font-bold">AI-powered visual measurement</span>\n        that lets every shopper see the garment on themselves and get their exact size before they pay.',
      'market.potentialTag': 'The potential · fewer returns · more conversions · confident buyers',
      'market.footnote':     '* The figures above come from widely cited fashion and e-commerce research, not from client results.',

      /* — final CTA — */
      'cta.title':   'Ready to bring your return rate down?',
      'cta.sub':     'One line of code. Five minutes. And your customers measure at home.',
      'cta.primary': '✨ Try the widget',
      'cta.docs':    'To the integration guide →',
      'cta.contact': 'Talk to us 💬',

      /* — docs view + access gate — */
      'docs.title':             'Widget integration guide',
      'docs.sub':               'Installing the <span class="brand-pear">PEAR</span> widget takes <span class="font-semibold text-slate-700">under 5 minutes</span> and needs no\n        changes to your site architecture. Three steps and your customers are measuring.',
      'docs.gateTitle':         'This guide is not public',
      'docs.gateSub':           'Access to the technical integration guide is granted manually by the development team.',
      'docs.gatePlaceholder':   'Access code',
      'docs.gateSubmit':        'Verify',
      'docs.gateChecking':      'Checking…',
      'docs.gateRequest':       'No access code? Fill in the form below and we will send you one right away →',
      'docs.errWrong':          'Wrong code — please try again.',
      'docs.errNoRuntime':      'Dev environment: no server runtime. Run vercel dev instead of Live Server.',
      'docs.errNoPasscode':     'Server misconfiguration: DOCS_PASSCODE is not set.',
      'docs.errRateLimit':      'Too many attempts — try again in 15 minutes.',

      /* — contact — */
      'contact.title':          'Let\'s talk',
      'contact.sub':            'A question about integration, a demo for your brand, or just want to say hello?\n        Fill in the form or reach us directly.',
      'contact.fieldName':      'Full name',
      'contact.phName':         'Jane Doe',
      'contact.fieldEmail':     'Email',
      'contact.phEmail':        'you@brand.com',
      'contact.fieldPhone':     'Phone',
      'contact.phPhone':        '+1 555 123 4567',
      'contact.fieldCompany':   'Company name',
      'contact.phCompany':      'Brand / company name',
      'contact.fieldRole':      'Role',
      'contact.phRole':         'e.g. Head of Digital',
      'contact.fieldSubject':   'Subject',
      'contact.phSubject':      'e.g. Demo request for a fashion brand',
      'contact.fieldMessage':   'Message',
      'contact.phMessage':      'Tell us a little about the project...',
      'contact.submit':         'Send message',
      'contact.sending':        'Sending…',
      'contact.sent':           'Sent ✓',
      'contact.toastSuccess':   'Your message is on its way! We will get back to you shortly',
      'contact.toastError':     'Sending failed — try again or email us directly',
      'contact.defaultSubject': 'New enquiry from the PEAR site',
      'contact.directTitle':    'Reach us directly',
      'contact.directSub':      'Prefer to talk directly? We are available by email.',
      'contact.teamNote':       'The <span class="brand-pear">PEAR</span> team is here for technical questions, brand demos and integration support.',

      /* — footer — */
      'footer.rights': '© 2026 <span class="brand-pear">PEAR</span> Platform (pearvton) — Virtual Try-On · All rights reserved',

      /* — toasts — */
      'toast.copied':     'Code copied to clipboard ✓',
      'toast.copyFailed': 'Copy failed — please copy manually',

      /* — contact-form prefills (set by tagged CTAs) — */
      'prefill.integration.subject': 'Help integrating PEAR on our site',
      'prefill.integration.message': 'Hi, I am trying to integrate PEAR on my site and would appreciate a hand from your technical team.',
      'prefill.docsAccess.subject':  'Access request for the integration guide',
      'prefill.docsAccess.message':  '🔐 Access request for the integration guide\n\nHi, I would like an access code for the PEAR technical integration guide.\n\n(To approve: reply to this email address with the access code)',
      'prefill.docsAccess.type':     'Integration guide access request 🔐',

      /* — the gated implementation guide (markup lives in api/get-docs.js) — */
      'guide.reqTitle':    'Overview and requirements',
      'guide.reqBody':     'The widget is a lightweight JavaScript snippet that loads asynchronously and does not affect your site speed.\n        It is platform-agnostic — it works with every e-commerce platform:',
      'guide.reqCustom':   'Custom / in-house build',
      'guide.stepsTitle':  'Integration steps',
      'guide.step1Title':  'Step 1 · Add the SDK script (CDN)',
      'guide.step1Body':   'Paste the line below just before the <code class="font-mono text-xs bg-slate-100 border border-slate-200 rounded px-1.5 py-0.5 text-slate-700" dir="ltr">&lt;/body&gt;</code> tag — once, on every product page.',
      'guide.step2Title':  'Step 2 · Place the measurement button on the product page',
      'guide.step2Body':   'Drop the container anywhere on the product page — usually under the size picker. The widget styles itself to fit its surroundings.',
      'guide.step3Title':  'Step 3 · Initialise and customise',
      'guide.step3Body':   'Full control over language, theme, button copy and callbacks — all from a single configuration object.',
      'guide.snipLocale':  '\'en\'',
      'guide.snipButton':  '\'Measure now with AI\'',
      'guide.snipComment': '// Called once the algorithm has computed a recommended size',
      'guide.snipLog':     '\'Recommended size:\'',
      'guide.helpTitle':   'Need a hand with the integration?',
      'guide.helpBody':    'The PEAR engineering team is available to help you wire the widget into your store quickly and painlessly.',
      'guide.helpCta':     'Talk to us now',
      'guide.helpArrow':   '→',
      'guide.note':        'Do not have a <span class="font-mono text-xs bg-white border border-pear-100 rounded px-1.5 py-0.5" dir="ltr">STORE_ID</span> yet?\n        <a href="mailto:pearytrank@gmail.com" class="font-semibold text-pear-700 underline underline-offset-2 hover:text-pear-600">Get in touch</a>\n        and we will set an account up within one business day.'
    }
  };

  /* ════════════════════════════════════════════════════════════════
     ENGINE
     ════════════════════════════════════════════════════════════════ */

  var state = {
    lang: DEFAULT_LANG,
    resolved: false,     // false while an async lookup is still in flight
    cloaked: false
  };
  var listeners = [];

  /* localStorage throws in Safari private mode and when cookies are
     blocked entirely — never let a storage failure break the page. */
  function readStore(key) {
    try { return window.localStorage.getItem(key); } catch (e) { return null; }
  }
  function writeStore(key, value) {
    try { window.localStorage.setItem(key, value); } catch (e) { /* non-fatal */ }
  }

  function isSupported(lang) {
    return SUPPORTED.indexOf(lang) !== -1;
  }
  function normalise(lang) {
    lang = String(lang || '').toLowerCase().slice(0, 2);
    return isSupported(lang) ? lang : null;
  }
  function dirFor(lang) {
    return RTL_LANGS.indexOf(lang) !== -1 ? 'rtl' : 'ltr';
  }

  /* ── Translation lookup ──────────────────────────────────────────
     Missing keys fall back to the other language rather than rendering
     an empty element, and finally to the key itself so a typo is loud
     in the UI instead of silently blanking a headline. */
  function t(key, lang) {
    lang = lang || state.lang;
    var table = DICT[lang] || {};
    if (Object.prototype.hasOwnProperty.call(table, key)) return table[key];
    var fallback = DICT[DEFAULT_LANG] || {};
    if (Object.prototype.hasOwnProperty.call(fallback, key)) return fallback[key];
    return key;
  }

  /* ── Language sources ────────────────────────────────────────── */

  function fromUrl() {
    var match = /[?&]lang=([^&#]+)/i.exec(window.location.search);
    return match ? normalise(decodeURIComponent(match[1])) : null;
  }

  function fromStorage() {
    return normalise(readStore(LANG_KEY));
  }

  function fromGeoCache() {
    var raw = readStore(GEO_KEY);
    if (!raw) return null;
    try {
      var rec = JSON.parse(raw);
      if (!rec || typeof rec.at !== 'number') return null;
      if (Date.now() - rec.at > GEO_TTL_MS) return null;       // stale — look it up again
      return normalise(rec.lang);
    } catch (e) {
      return null;
    }
  }

  /* One provider, one attempt, given `timeoutMs` to answer in — the
     caller (fromIpLookup) decides that per-attempt, based on how much of
     the shared GEO_BUDGET_MS is left. Resolves to an UPPERCASE country
     code; rejects on anything that isn't a usable answer — bad HTTP
     status, timeout/abort, network/CORS failure, or a body extract()
     can't read — so the caller can move on to the next provider. */
  function fetchCountryCode(source, timeoutMs) {
    if (typeof window.fetch !== 'function') {
      return Promise.reject(new Error('fetch unavailable'));
    }

    var controller = typeof window.AbortController === 'function' ? new window.AbortController() : null;
    var timer = window.setTimeout(function () {
      if (controller) controller.abort();
    }, timeoutMs);

    var opts = { headers: { Accept: 'application/json' }, cache: 'no-store' };
    if (controller) opts.signal = controller.signal;

    function settle(fn) {
      return function (arg) { window.clearTimeout(timer); return fn(arg); };
    }

    return window.fetch(source.url, opts)
      .then(settle(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      }), settle(function (err) { throw err; }))
      .then(function (data) {
        var cc = String(source.extract(data) || '').toUpperCase();
        if (!cc) throw new Error('no country code in response');
        return cc;
      });
  }

  /* Country lookup. Tries GEO_SOURCES in order, sharing ONE deadline
     (now = GEO_BUDGET_MS from when this was first called) across all of
     them, and resolves to a language from the first one that answers
     with a usable country code — falling through to the next source
     immediately on any failure. Rejects once every source has failed OR
     the shared budget runs out, either of which is the caller's (see
     boot, below) signal to fall back to DEFAULT_LANG.

     STRICT DEFAULTING: whichever source answers, only an exact 'IL' match
     resolves to Hebrew — every other code (US, DE, an unrecognised one,
     anything) resolves to English. There is no path from a successful IP
     lookup to a browser-locale guess: a VPN visitor whose browser locale
     happens to be Hebrew still gets English the moment any provider
     confirms a non-IL exit location. */
  function fromIpLookup() {
    var i = 0;
    var deadline = Date.now() + GEO_BUDGET_MS;
    function tryNext() {
      var remaining = deadline - Date.now();
      if (i >= GEO_SOURCES.length || remaining <= 0) {
        return Promise.reject(new Error('all geolocation sources failed'));
      }
      var source = GEO_SOURCES[i++];
      return fetchCountryCode(source, remaining)
        .then(function (cc) {
          var lang = cc === GEO_COUNTRY ? GEO_LANG : DEFAULT_LANG;
          // eslint-disable-next-line no-console
          console.log('Detected Country:', cc, '(via ' + source.label + ') → lang:', lang);
          return { lang: lang, country: cc };
        })
        .catch(function (err) {
          // eslint-disable-next-line no-console
          console.warn('[PearI18n] ' + source.label + ' geo lookup failed:', err && err.message ? err.message : err);
          return tryNext();
        });
    }
    return tryNext();
  }

  /* ── DOM helpers ─────────────────────────────────────────────── */

  function whenDomReady(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn, { once: true });
    else fn();
  }

  /* querySelectorAll misses the root node itself — which matters when
     apply() is handed a freshly injected subtree whose outermost element
     carries the attribute. */
  function collect(root, attr) {
    var out = [];
    if (root.nodeType === 1 && root.hasAttribute(attr)) out.push(root);
    var found = root.querySelectorAll('[' + attr + ']');
    for (var i = 0; i < found.length; i++) out.push(found[i]);
    return out;
  }

  function setMeta(selector, value) {
    var el = document.head && document.head.querySelector(selector);
    if (el) el.setAttribute('content', value);
  }

  /* ── Applying a language ─────────────────────────────────────── */

  /* <head>: everything a crawler reads before it looks at the body. */
  function applyHead(lang, explicit) {
    var root = document.documentElement;
    root.setAttribute('lang', lang);
    root.setAttribute('dir', dirFor(lang));

    document.title = t('meta.title', lang);
    setMeta('meta[name="description"]',           t('meta.description', lang));
    setMeta('meta[name="keywords"]',              t('meta.keywords', lang));
    setMeta('meta[property="og:title"]',          t('meta.ogTitle', lang));
    setMeta('meta[property="og:description"]',    t('meta.ogDescription', lang));
    setMeta('meta[property="og:locale"]',         OG_LOCALE[lang] || OG_LOCALE[DEFAULT_LANG]);
    setMeta('meta[name="twitter:title"]',         t('meta.twitterTitle', lang));
    setMeta('meta[name="twitter:description"]',   t('meta.twitterDescription', lang));

    /* og:url and canonical must agree with the hreflang alternates:
       a language-specific URL is self-canonical, the bare root is the
       x-default. Pointing ?lang=en back at / would make Google drop the
       alternate set entirely. */
    var langUrl = SITE_ORIGIN + '/?lang=' + lang;
    /* Callers that are about to WRITE ?lang= into the address bar say so,
       because reading it back here would still see the old URL and leave
       canonical pointing at the x-default root while the visitor sits on
       a language-specific URL. */
    if (explicit === undefined) explicit = fromUrl() !== null;
    var canonicalHref = explicit ? langUrl : SITE_ORIGIN + '/';
    var canonical = document.head && document.head.querySelector('link[rel="canonical"]');
    if (canonical) canonical.setAttribute('href', canonicalHref);
    setMeta('meta[property="og:url"]', canonicalHref);

    /* Structured data: keep the description in the page's language and
       declare which language that is. */
    var ld = document.getElementById('ld-webapp');
    if (ld) {
      try {
        var data = JSON.parse(ld.textContent);
        data.description = t('meta.jsonldDescription', lang);
        data.inLanguage = lang;
        ld.textContent = JSON.stringify(data, null, 2);
      } catch (e) { /* malformed JSON-LD is not worth breaking boot over */ }
    }
  }

  /* <body>: every element carrying a data-i18n* attribute.
     `root` defaults to the whole document but can be a subtree — that is
     how the passcode-gated guide gets translated after it is injected. */
  function applyDOM(root, lang) {
    root = root || document.body;
    lang = lang || state.lang;
    if (!root) return;

    /* Rewriting text/innerHTML throws away whatever the page has built on
       top of it — most visibly the GSAP word-splitter's per-word spans,
       and the ScrollTrigger instances pointing at them. Each element
       therefore records the language it currently carries, and a pass
       that would rewrite it in that same language is skipped.

       This is what makes the DOM-ready sweep at the bottom of this file
       safe: it re-visits elements the in-body bootstrap already
       translated, and must leave them exactly as it found them. A
       genuine language change stamps a different value, so everything is
       rewritten and listeners re-split the fresh copy as before. */
    collect(root, 'data-i18n').forEach(function (el) {
      if (el.getAttribute(STAMP) === lang) return;
      el.textContent = t(el.getAttribute('data-i18n'), lang);
      el.setAttribute(STAMP, lang);
    });

    /* innerHTML, by design — see the security note at the top of the file. */
    collect(root, 'data-i18n-html').forEach(function (el) {
      if (el.getAttribute(STAMP) === lang) return;
      el.innerHTML = t(el.getAttribute('data-i18n-html'), lang);
      el.setAttribute(STAMP, lang);
    });

    [['data-i18n-placeholder', 'placeholder'],
     ['data-i18n-aria-label',  'aria-label'],
     ['data-i18n-title',       'title'],
     ['data-i18n-alt',         'alt'],
     ['data-i18n-value',       'value']].forEach(function (pair) {
      collect(root, pair[0]).forEach(function (el) {
        el.setAttribute(pair[1], t(el.getAttribute(pair[0]), lang));
      });
    });

    /* Language switch: reflect the active option for both sighted users
       (CSS on [aria-pressed]) and screen readers. */
    collect(root, 'data-set-lang').forEach(function (el) {
      el.setAttribute('aria-pressed', el.getAttribute('data-set-lang') === lang ? 'true' : 'false');
    });
  }

  function notify(lang) {
    for (var i = 0; i < listeners.length; i++) {
      try { listeners[i](lang); } catch (e) { /* one bad listener must not stop the rest */ }
    }
  }

  /* ── The first-visit cloak ───────────────────────────────────── */

  function cloak() {
    state.cloaked = true;
    document.documentElement.classList.add('i18n-cloak');
    window.setTimeout(uncloak, CLOAK_MAX_MS);   // failsafe: never stay hidden
  }
  function uncloak() {
    if (!state.cloaked) return;
    state.cloaked = false;
    document.documentElement.classList.remove('i18n-cloak');
  }

  /* ── Boot ────────────────────────────────────────────────────── */

  /* Makes <head> AND <body> actually reflect `lang`, right now — this is
     the one place that turns a resolved language into a rendered page.

     WHY BOTH AN IMMEDIATE PASS AND A DEFERRED ONE: the old version chose
     ONE of "apply now" or "apply once at DOMContentLoaded" based on
     `document.readyState` at the instant this ran, decided by the
     CALLER via an opt-in `deferDom` flag. That left a real gap for the
     async IP lookup specifically: a fast answer (an already-warm
     connection, a cached response, ipapi.co replying in a handful of
     milliseconds) can resolve its promise while the document is still
     mid-parse — `document.body` already exists (the parser is somewhere
     inside it) but `readyState` is still 'loading'. The either/or logic
     had no case that both applies to what already exists in the DOM
     *and* guarantees a follow-up for what the parser hasn't reached yet;
     depending on exactly which branch fired, a result could apply to a
     body that didn't fully exist yet with nothing left to re-run it.

     The fix is to stop choosing: apply immediately whenever there is a
     body to apply to, AND separately, unconditionally, schedule a
     follow-up whenever the document is still loading. Both is always
     safe — applyDOM's per-element language stamp (see STAMP above) makes
     a repeat call with the same lang a costless no-op, so running commit
     twice never double-translates or re-shreds an already-split
     headline. This is what actually closes the race the old code had,
     not just papers over one branch of it. */
  function applyLanguage(lang, opts) {
    opts = opts || {};
    var changed = lang !== state.lang;
    state.lang = lang;

    applyHead(lang, opts.explicitUrl);
    /* Belt-and-suspenders alongside the setAttribute('dir', …) inside
       applyHead: the IDL property and the content attribute reflect each
       other, so this is a no-op in every real browser — but it means
       anything reading `documentElement.dir` directly (rather than via
       getAttribute) is served just as immediately as the CSS is. */
    document.documentElement.dir = dirFor(lang);

    /* Order is load-bearing: listeners must not fire until the DOM
       actually carries the new copy. index.html's listener re-splits the
       headlines into per-word spans, and re-splitting text that has not
       been replaced yet would shred the OLD language and then have it
       overwritten a moment later. */
    function commit() {
      // eslint-disable-next-line no-console
      console.log('Applying language:', lang);
      applyDOM(document.body, lang);
      if (changed || opts.force) notify(lang);
    }

    if (document.body) commit();
    if (document.readyState === 'loading') whenDomReady(commit);

    return lang;
  }

  /* The persisted/manual-switch entry point: applyLanguage() plus the
     bookkeeping that only a deliberate visitor choice needs — writing
     localStorage and keeping the address bar in step with it. */
  function setLanguage(lang, opts) {
    opts = opts || {};
    lang = normalise(lang) || DEFAULT_LANG;

    if (opts.persist) {
      writeStore(LANG_KEY, lang);
      // eslint-disable-next-line no-console
      console.log('Active language source:', 'manual', lang);
    }

    applyLanguage(lang, { force: opts.force, explicitUrl: opts.persist ? true : undefined });

    /* Keep the address bar in step with an explicit choice, so the URL
       stays copy-pasteable and reloads in the same language. History is
       replaced, not pushed: language is not a navigation step. */
    if (opts.persist && window.history && window.history.replaceState) {
      try {
        var url = new URL(window.location.href);
        url.searchParams.set('lang', lang);
        window.history.replaceState(window.history.state, '', url.toString());
      } catch (e) { /* older browsers: the URL just stays as it was */ }
    }

    return lang;
  }

  /* Synchronous sources first — the fast path with no flicker at all.
     NOTE on ?lang=: it is read here to decide THIS load's language but,
     unlike the other two, deliberately NOT written to LANG_KEY. It used
     to be ("a shared ?lang= link is a choice, also persisted so it
     sticks") — but that meant one visit via an old marketing link, a
     search-engine crawl, or a developer previewing a language during
     testing silently and permanently pinned that browser's language,
     indistinguishable afterward from a real click on the toggle, and
     overriding geo-IP detection on every future visit forever after.
     That is precisely the "IP resolves to US but the page keeps showing
     Hebrew" report this was diagnosed from: a stale, accidental
     app_lang='he' outliving whatever visit actually wrote it. Only an
     actual click on [data-set-lang] (setLanguage's opts.persist path,
     above) counts as an explicit, sticky choice now. */
  var immediate = fromUrl();
  var immediateSource = immediate ? 'url' : null;
  if (!immediate) { immediate = fromStorage(); if (immediate) immediateSource = 'localStorage'; }
  if (!immediate) { immediate = fromGeoCache(); if (immediate) immediateSource = 'geoCache'; }

  if (immediate) {
    state.lang = immediate;
    state.resolved = true;
    applyHead(immediate);
    // eslint-disable-next-line no-console
    console.log('Active language source:', immediateSource, immediate);
  } else {
    /* First visit ever: show nothing until the country lookup answers,
       so an English-speaking visitor never sees a frame of Hebrew RTL.
       The provisional guess is DEFAULT_LANG, not a browser-locale guess
       — see the RESOLUTION ORDER note at the top of this file for why
       navigator.language is not consulted anywhere in this file. */
    state.lang = DEFAULT_LANG;
    applyHead(state.lang);
    cloak();

    fromIpLookup()
      .then(function (result) {
        writeStore(GEO_KEY, JSON.stringify({ lang: result.lang, country: result.country, at: Date.now() }));
        return { lang: result.lang, source: 'geoIP' };
      })
      .catch(function () {
        // eslint-disable-next-line no-console
        console.warn('[PearI18n] all IP geolocation sources failed — defaulting to', DEFAULT_LANG);
        return { lang: DEFAULT_LANG, source: 'fallback' };   // every GEO_SOURCES provider was blocked, offline, or ran out of budget
      })
      .then(function (resolved) {
        state.resolved = true;
        // eslint-disable-next-line no-console
        console.log('Active language source:', resolved.source, resolved.lang);
        applyLanguage(resolved.lang, { force: true });
        /* Uncloak only once the body actually carries the final copy.
           applyLanguage() above may already have committed synchronously
           (if <body> existed and the document was no longer loading) or
           only scheduled its DOMContentLoaded follow-up — either way,
           registering this listener AFTER that call, not before, is what
           keeps the two in order: a still-cloaked page never becomes
           visible carrying the language it's about to replace. */
        whenDomReady(uncloak);
      });
  }

  /* ── Public API ──────────────────────────────────────────────── */
  window.PearI18n = {
    /** Active language code ('he' | 'en'). */
    getLang: function () { return state.lang; },
    /** Text direction for the active language ('rtl' | 'ltr'). */
    getDir: function () { return dirFor(state.lang); },
    /** Look up a key; falls back to English, then to the key itself. */
    t: t,
    /** Translate a subtree (defaults to <body>). Safe to call repeatedly. */
    apply: function (root) { applyDOM(root || document.body, state.lang); },
    /** Switch language from the UI — persists to localStorage['app_lang']. */
    setLang: function (lang) { return setLanguage(lang, { persist: true }); },
    /** Register a callback fired on every language change. */
    onChange: function (fn) { if (typeof fn === 'function') listeners.push(fn); },
    /** Supported codes, for anything that wants to render a switcher. */
    languages: SUPPORTED.slice()
  };

  /* Safety net: if nothing else called apply() by the time the DOM is
     ready (script order changed, an inline block threw), translate anyway. */
  whenDomReady(function () { applyDOM(document.body, state.lang); });

})(window, document);
