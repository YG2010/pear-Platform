/* ════════════════════════════════════════════════════════════════════
   PEAR · i18n — automatic Hebrew / English localisation
   ════════════════════════════════════════════════════════════════════

   LOADING: this file is a CLASSIC, RENDER-BLOCKING <script> in <head>,
   deliberately not defer/async. It has to run before the browser paints
   the body, because it sets <html lang> / <html dir> and swaps the
   document title + meta description. Deferring it would show a frame of
   Hebrew RTL layout to an English visitor.

   RESOLUTION ORDER (first hit wins):
     1. ?lang=he|en in the URL  — what the hreflang alternates point at,
        so a search engine landing on /?lang=en gets English markup with
        no guessing at all. Also persisted, so the choice sticks.
     2. localStorage['app_lang'] — an explicit choice from the navbar
        switch. A visitor who picked a language is never overridden.
     3. localStorage['app_lang_geo'] — a cached country lookup (30 days),
        so only the very first visit ever pays for a network round trip.
     4. https://ipapi.co/json/  — country_code === 'IL' → Hebrew,
        everything else (US included) → English.
     5. navigator.language(s) — the fallback when the lookup fails, is
        blocked by an ad blocker, rate-limits, or times out. Starts with
        'he' → Hebrew, otherwise English.

   THE CLOAK: steps 1–3 are synchronous, so the common case resolves
   before first paint with zero flicker and no cloak at all. Only a
   first-ever visit reaches step 4, which is async — for that case only,
   <html> gets .i18n-cloak (a CSS rule fades the body out) until the
   lookup settles or CLOAK_MAX_MS elapses, whichever comes first. The
   failsafe timer matters: it guarantees the page can never be left
   invisible by a hanging request.

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

  var LANG_KEY        = 'app_lang';      // explicit visitor choice
  var GEO_KEY         = 'app_lang_geo';  // cached auto-detection
  var GEO_TTL_MS      = 30 * 24 * 60 * 60 * 1000;

  var GEO_ENDPOINT    = 'https://ipapi.co/json/';
  var GEO_TIMEOUT_MS  = 1000;   // abort the lookup rather than stall the page
  var CLOAK_MAX_MS    = 1200;   // hard ceiling on the first-visit cloak

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

  /* Browser-language fallback. The spec is navigator.language, but we
     also scan navigator.languages: a visitor whose primary UI language
     is English while Hebrew sits second is still a Hebrew reader. */
  function fromNavigator() {
    var primary = String(window.navigator.language || '').toLowerCase();
    if (primary.indexOf('he') === 0) return 'he';
    var list = window.navigator.languages || [];
    for (var i = 0; i < list.length; i++) {
      if (String(list[i] || '').toLowerCase().indexOf('he') === 0) return 'he';
    }
    return DEFAULT_LANG;
  }

  /* Country lookup. Resolves to a language; rejects on anything that
     is not a usable answer so the caller can fall back cleanly.
     ipapi.co signals rate limiting with HTTP 200 + {"error":true}, so
     an ok status is not enough — the body has to be checked too. */
  function fromIpLookup() {
    if (typeof window.fetch !== 'function') {
      return Promise.reject(new Error('fetch unavailable'));
    }

    var controller = typeof window.AbortController === 'function' ? new window.AbortController() : null;
    var timer = window.setTimeout(function () {
      if (controller) controller.abort();
    }, GEO_TIMEOUT_MS);

    var opts = { headers: { Accept: 'application/json' }, cache: 'no-store' };
    if (controller) opts.signal = controller.signal;

    return window.fetch(GEO_ENDPOINT, opts)
      .then(function (res) {
        if (!res.ok) throw new Error('ipapi HTTP ' + res.status);
        return res.json();
      })
      .then(function (data) {
        if (!data || data.error) throw new Error('ipapi: ' + ((data && data.reason) || 'error'));
        var cc = String(data.country_code || '').toUpperCase();
        if (!cc) throw new Error('ipapi: no country_code');
        return { lang: cc === GEO_COUNTRY ? GEO_LANG : DEFAULT_LANG, country: cc };
      })
      .then(function (result) {
        window.clearTimeout(timer);
        return result;
      }, function (err) {
        window.clearTimeout(timer);
        throw err;
      });
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
  function applyHead(lang) {
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
    var explicit = fromUrl() !== null;
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

    collect(root, 'data-i18n').forEach(function (el) {
      el.textContent = t(el.getAttribute('data-i18n'), lang);
    });

    /* innerHTML, by design — see the security note at the top of the file. */
    collect(root, 'data-i18n-html').forEach(function (el) {
      el.innerHTML = t(el.getAttribute('data-i18n-html'), lang);
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

  function setLanguage(lang, opts) {
    opts = opts || {};
    lang = normalise(lang) || DEFAULT_LANG;

    var changed = lang !== state.lang;
    state.lang = lang;

    if (opts.persist) writeStore(LANG_KEY, lang);

    /* Order is load-bearing: listeners must not fire until the DOM
       actually carries the new copy. index.html's listener re-splits the
       headlines into per-word spans, and re-splitting text that has not
       been replaced yet would shred the OLD language and then have it
       overwritten a moment later. */
    function commit() {
      applyDOM(document.body, lang);
      if (changed || opts.force) notify(lang);
    }

    applyHead(lang);
    if (opts.deferDom && document.readyState === 'loading') whenDomReady(commit);
    else commit();

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

  /* Synchronous sources first — the fast path with no flicker at all. */
  var immediate = fromUrl();
  if (immediate) writeStore(LANG_KEY, immediate);        // a shared ?lang= link is a choice
  if (!immediate) immediate = fromStorage();
  if (!immediate) immediate = fromGeoCache();

  if (immediate) {
    state.lang = immediate;
    state.resolved = true;
    applyHead(immediate);
  } else {
    /* First visit ever: show nothing until the country lookup answers,
       so an English-speaking visitor never sees a frame of Hebrew RTL. */
    state.lang = fromNavigator();     // provisional, in case the lookup dies
    applyHead(state.lang);
    cloak();

    fromIpLookup()
      .then(function (result) {
        writeStore(GEO_KEY, JSON.stringify({ lang: result.lang, country: result.country, at: Date.now() }));
        return result.lang;
      })
      .catch(function () {
        return fromNavigator();       // blocked, offline, rate-limited or slow
      })
      .then(function (lang) {
        state.resolved = true;
        setLanguage(lang, { deferDom: true, force: true });
        /* Uncloak only once the body actually carries the final copy. */
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
