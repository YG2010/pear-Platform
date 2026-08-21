/* ══════════════════════════════════════════════════════════════════
   PEAR · ATELIER MOTION LAYER
   ------------------------------------------------------------------
   The interaction layer for the landing view: custom cursor, magnetic
   buttons, card tilt with a cursor-tracked highlight, staggered scroll
   reveals, light parallax, nav state and the footer clock.

   Deliberately NOT included: a smooth-scroll hijacker. This page routes
   three views, opens a server-gated docs route and moves the viewport
   from data-scroll handlers; taking ownership of the scroll position
   away from the browser risks all three for a nicety, so the native
   scroller keeps it and GSAP animates on top.

   Everything here degrades to nothing: if GSAP never loads, the .pa-js
   class is dropped and the stylesheet stops hiding anything.
   ══════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
  var FINE = matchMedia('(hover: hover) and (pointer: fine)').matches;

  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  /* Frame-rate independent: a raw a += (b-a)*k settles twice as fast at
     120Hz as at 60Hz, which makes the cursor feel different per display. */
  function damp(a, b, l, dt) { return lerp(a, b, 1 - Math.exp(-l * dt)); }

  var frameTasks = [];
  function onFrame(fn) { frameTasks.push(fn); }

  /* ─────────────────────────── BOOT ─────────────────────────────── */

  function waitForGsap(cb) {
    var t0 = Date.now();
    (function poll() {
      if (window.gsap && window.ScrollTrigger) return cb(true);
      if (Date.now() - t0 > 6000) return cb(false);
      requestAnimationFrame(poll);
    })();
  }

  function boot() {
    waitForGsap(function (ok) {
      if (!ok) {
        // no animation engine: unhide everything and stop
        document.documentElement.classList.remove('pa-js');
        return;
      }

      gsap.registerPlugin(ScrollTrigger);
      gsap.ticker.lagSmoothing(0);

      var last = performance.now();
      gsap.ticker.add(function () {
        var now = performance.now();
        var dt = clamp((now - last) / 1000, 0, 0.064);
        last = now;
        for (var i = 0; i < frameTasks.length; i++) frameTasks[i](dt, now / 1000);
      });

      initStageReveal();
      initCursor();
      initMagnetic();
      initTilt();
      initTouch();
      initReveals();
      initParallax();
      initNav();
      initHud();
      initClock();

      /* Late media (videos, web fonts) resize the page after the first
         measurement pass; without this the reveal triggers sit at stale
         scroll offsets for the rest of the session. */
      window.addEventListener('load', function () { ScrollTrigger.refresh(); });
      if (document.fonts) document.fonts.ready.then(function () { ScrollTrigger.refresh(); });
    });
  }

  /* ─────────────────────── WEBGL REVEAL ─────────────────────────── */
  /* The stylesheet keeps #pearStage at opacity 0 so the 3D layer fades
     in rather than popping mid-build. The scene itself is constructed
     by the existing module further down the page, which knows nothing
     about that class — so the fade is armed here, once a canvas has
     actually been appended. Without this the whole layer stays
     invisible forever. */
  function initStageReveal() {
    var stage = $('#pearStage');
    if (!stage) return;

    var reveal = function () { stage.classList.add('is-ready'); };
    if (stage.querySelector('canvas')) return reveal();

    var obs = new MutationObserver(function () {
      if (stage.querySelector('canvas')) { obs.disconnect(); reveal(); }
    });
    obs.observe(stage, { childList: true });

    /* The module is dynamically imported and can fail (no WebGL, a
       blocked CDN). Stop watching rather than leaking an observer. */
    setTimeout(function () { obs.disconnect(); }, 12000);
  }

  /* ────────────────────────── CURSOR ────────────────────────────── */

  function initCursor() {
    if (REDUCED || !FINE) return;

    var root = document.createElement('div');
    root.className = 'pa-cursor';
    root.setAttribute('aria-hidden', 'true');
    root.innerHTML =
      '<div class="pa-cursor__ring"><span class="pa-cursor__label"></span></div>' +
      '<div class="pa-cursor__dot"></div>';
    document.body.appendChild(root);
    document.documentElement.classList.add('pa-cursor-on');

    var ring = $('.pa-cursor__ring', root);
    var dot = $('.pa-cursor__dot', root);
    var label = $('.pa-cursor__label', root);

    var p = { x: innerWidth / 2, y: innerHeight / 2 };
    var d = { x: p.x, y: p.y };
    var r = { x: p.x, y: p.y };
    var snap = null;

    addEventListener('pointermove', function (e) { p.x = e.clientX; p.y = e.clientY; }, { passive: true });
    addEventListener('pointerdown', function () { root.classList.add('is-down'); });
    addEventListener('pointerup', function () { root.classList.remove('is-down'); });

    onFrame(function (dt) {
      d.x = damp(d.x, p.x, 34, dt);
      d.y = damp(d.y, p.y, 34, dt);
      /* On a magnetic target the ring stops chasing the pointer and
         eases to the element's centre — that snap is the whole "the
         button caught it" sensation. */
      var tx = snap ? snap.x : p.x;
      var ty = snap ? snap.y : p.y;
      r.x = damp(r.x, tx, snap ? 16 : 11, dt);
      r.y = damp(r.y, ty, snap ? 16 : 11, dt);
      dot.style.transform = 'translate3d(' + d.x + 'px,' + d.y + 'px,0) translate(-50%,-50%)';
      ring.style.transform = 'translate3d(' + r.x + 'px,' + r.y + 'px,0) translate(-50%,-50%)';
    });

    var HOVER = 'a, button, [data-pa-hover], input, textarea, select';

    function centreOf(el) {
      var b = el.getBoundingClientRect();
      return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
    }

    document.addEventListener('pointerover', function (e) {
      if (!e.target.closest) return;
      var badge = e.target.closest('[data-pa-badge]');
      var hover = e.target.closest(HOVER);
      if (badge) {
        label.textContent = badge.getAttribute('data-pa-badge');
        root.classList.add('is-badge');
        root.classList.remove('is-hover');
        snap = null;
      } else if (hover) {
        root.classList.add('is-hover');
        root.classList.remove('is-badge');
        snap = centreOf(hover);
      }
    });

    document.addEventListener('pointerout', function (e) {
      if (!e.target.closest) return;
      if (e.relatedTarget && e.target.contains && e.target.contains(e.relatedTarget)) return;
      if (e.target.closest('[data-pa-badge]')) root.classList.remove('is-badge');
      if (e.target.closest(HOVER)) { root.classList.remove('is-hover'); snap = null; }
    });

    /* Recompute while travelling across a wide button, or the ring
       parks on a centre that scrolling has already invalidated. */
    document.addEventListener('pointermove', function (e) {
      if (!snap || !e.target.closest) return;
      var el = e.target.closest(HOVER);
      snap = el ? centreOf(el) : null;
    }, { passive: true });
  }

  /* ───────────────────── MAGNETIC BUTTONS ───────────────────────── */
  /* The cursor snapping to the button and the button leaning toward the
     cursor are two halves of one effect; either alone reads as broken. */

  function initMagnetic() {
    if (REDUCED || !FINE) return;
    $$('.pa-magnetic').forEach(function (el) {
      var xTo = gsap.quickTo(el, 'x', { duration: .6, ease: 'power3' });
      var yTo = gsap.quickTo(el, 'y', { duration: .6, ease: 'power3' });
      el.addEventListener('pointermove', function (e) {
        var b = el.getBoundingClientRect();
        xTo((e.clientX - b.left - b.width / 2) * 0.26);
        yTo((e.clientY - b.top - b.height / 2) * 0.42);
      });
      el.addEventListener('pointerleave', function () { xTo(0); yTo(0); });
    });
  }

  /* ──────────────── CARD TILT + CURSOR HIGHLIGHT ────────────────── */

  function initTilt() {
    if (!FINE) return;

    $$('[data-pa-tilt]').forEach(function (el) {
      var rx = gsap.quickTo(el, 'rotationX', { duration: .7, ease: 'power3' });
      var ry = gsap.quickTo(el, 'rotationY', { duration: .7, ease: 'power3' });

      el.addEventListener('pointermove', function (e) {
        var b = el.getBoundingClientRect();
        var px = (e.clientX - b.left) / b.width;
        var py = (e.clientY - b.top) / b.height;

        /* The highlight is a CSS custom property rather than a moving
           element: one paint, no extra node, and it survives the card
           being re-rendered by a language switch. */
        el.style.setProperty('--mx', (px * 100) + '%');
        el.style.setProperty('--my', (py * 100) + '%');

        if (REDUCED) return;
        // shallow on purpose — past ~8deg the shadow stops agreeing
        // with the light source and the card reads as a sticker
        ry((px - .5) * 9);
        rx((.5 - py) * 9);
      });

      el.addEventListener('pointerleave', function () {
        if (REDUCED) return;
        rx(0); ry(0);
      });
    });
  }

  /* ─────────────────── TOUCH · DIRECT MANIPULATION ───────────────── */
  /* The hover layer above (cursor, magnetic lean, tilt) is all gated on
     a fine pointer, which leaves a phone visitor tapping surfaces that
     never answer. This is the answer: the card follows the finger.

     Three states, in order: press (the surface dips), drag (it leans
     toward the finger and rubber-bands as it is pulled further), release
     (it springs home). The spring overshoot is the point — a linear
     return reads as an animation, an elastic one reads as the object
     having weight.

     Bound to the same [data-pa-tilt] elements the desktop uses, plus
     anything opted in with [data-pa-touch], so a card gets exactly one
     interaction model per device and never both.

     Deliberately NOT preventDefault() on touchmove: these cards sit in
     the middle of a scrolling page, and swallowing the gesture would
     mean a finger landing on a card cannot scroll past it. Instead the
     first few pixels of movement decide — mostly vertical hands the
     gesture back to the scroller and the lean is abandoned. */

  function initTouch() {
    if (FINE) return;                      // a mouse is present; hover owns these

    var TARGETS = '[data-pa-tilt], [data-pa-touch]';
    var MAX_LEAN = 7;                      // degrees, matches the desktop tilt
    var MAX_SHIFT = 10;                    // px of travel before the rubber band
    var SLOP = 9;                          // px before the gesture commits

    $$(TARGETS).forEach(function (el) {
      var rect = null;
      var start = null;
      var axis = '';                       // '', 'lean' or 'scroll'
      var raf = 0;

      /* quickTo keeps one tween per property alive rather than spawning a
         new one per touchmove event — at 120Hz that is the difference
         between a lean and a stutter. */
      var rx = gsap.quickTo(el, 'rotationX', { duration: .35, ease: 'power3' });
      var ry = gsap.quickTo(el, 'rotationY', { duration: .35, ease: 'power3' });
      var tx = gsap.quickTo(el, 'x', { duration: .35, ease: 'power3' });
      var ty = gsap.quickTo(el, 'y', { duration: .35, ease: 'power3' });

      /* Rubber band: linear for the first few pixels, then asymptotic.
         Past the limit the card keeps answering the finger but refuses
         to keep up with it, which is what communicates "held". */
      function band(d, limit) {
        return limit * (1 - Math.exp(-Math.abs(d) / (limit * 1.6))) * (d < 0 ? -1 : 1);
      }

      /* Takes plain numbers, never the Touch object: Safari recycles Touch
         instances between events, so a reference read one frame later can
         report a position the finger has already left. */
      function paint(cx, cy) {
        raf = 0;
        if (!rect || !start) return;
        var px = (cx - rect.left) / rect.width;
        var py = (cy - rect.top) / rect.height;
        el.style.setProperty('--mx', clamp(px * 100, 0, 100) + '%');
        el.style.setProperty('--my', clamp(py * 100, 0, 100) + '%');
        if (REDUCED) return;
        ry((clamp(px, 0, 1) - .5) * 2 * MAX_LEAN);
        rx((.5 - clamp(py, 0, 1)) * 2 * MAX_LEAN);
        tx(band(cx - start.x, MAX_SHIFT));
        ty(band(cy - start.y, MAX_SHIFT));
      }

      el.addEventListener('touchstart', function (e) {
        if (e.touches.length !== 1) return;     // a pinch is not a press
        var t = e.touches[0];
        rect = el.getBoundingClientRect();
        start = { x: t.clientX, y: t.clientY };
        axis = '';
        el.classList.add('is-pressed', 'is-touching');
        if (!REDUCED) gsap.to(el, { scale: .978, duration: .18, ease: 'power2.out' });
        el.style.setProperty('--mx', ((t.clientX - rect.left) / rect.width * 100) + '%');
        el.style.setProperty('--my', ((t.clientY - rect.top) / rect.height * 100) + '%');
      }, { passive: true });

      el.addEventListener('touchmove', function (e) {
        if (!start || e.touches.length !== 1) return;
        var t = e.touches[0];
        var dx = t.clientX - start.x;
        var dy = t.clientY - start.y;

        if (!axis) {
          if (Math.abs(dx) < SLOP && Math.abs(dy) < SLOP) return;
          /* A mostly-vertical drag is the visitor scrolling the page with
             their finger where a card happens to be. Let go of it
             completely — a card that keeps leaning while the page moves
             under it reads as the page being stuck. */
          axis = Math.abs(dy) > Math.abs(dx) * 1.25 ? 'scroll' : 'lean';
          if (axis === 'scroll') return release();
        }
        if (axis !== 'lean') return;

        el.classList.remove('is-pressed');
        var cx = t.clientX, cy = t.clientY;
        if (!raf) raf = requestAnimationFrame(function () { paint(cx, cy); });
      }, { passive: true });

      function release() {
        if (!start) return;
        start = null; rect = null; axis = '';
        if (raf) { cancelAnimationFrame(raf); raf = 0; }
        el.classList.remove('is-pressed', 'is-touching');
        if (REDUCED) return;
        /* One tween over all five properties so they arrive together;
           elastic.out is the spring, and the low amplitude keeps the
           overshoot to a single visible bounce rather than a wobble. */
        gsap.to(el, {
          x: 0, y: 0, rotationX: 0, rotationY: 0, scale: 1,
          duration: .9, ease: 'elastic.out(0.9, 0.42)',
        });
      }

      el.addEventListener('touchend', release, { passive: true });
      el.addEventListener('touchcancel', release, { passive: true });
    });

    /* Buttons and links get the press dip without the lean: they are
       small, often inside a scrolling list, and a leaning button is a
       button whose hit area moved out from under the finger.

       Delegated rather than bound per element — the guide's markup and
       the widget's CTA arrive long after this runs. */
    var TAPPABLE = '.pa-btn, .pa-nav__link, .pa-lang button, .pa-guide__copy, .pa-field__input, .pa-submit';

    document.addEventListener('touchstart', function (e) {
      var el = e.target.closest && e.target.closest(TAPPABLE);
      if (el) el.classList.add('is-tapped');
    }, { passive: true });

    ['touchend', 'touchcancel', 'touchmove'].forEach(function (evt) {
      document.addEventListener(evt, function (e) {
        var el = e.target.closest && e.target.closest(TAPPABLE);
        if (el) el.classList.remove('is-tapped');
      }, { passive: true });
    });
  }

  /* ─────────── PRODUCT SHOT · MODEL REVEAL FLIP ───────────
     Desktop hover/focus flips the card via CSS alone (see .pa-flip:hover
     in the stylesheet). This wires the tap/click toggle touch devices
     need — and works for any pointer, since click-to-pin is a harmless
     superset of hover-to-preview. Runs unconditionally, outside the
     GSAP boot gate, so the shot still answers a tap even if GSAP never
     loads and the rest of the motion layer stays dark. */
  function initFlip() {
    var el = $('[data-pa-flip]');
    if (!el) return;

    function toggle() {
      var flipped = el.classList.toggle('is-flipped');
      el.setAttribute('aria-pressed', String(flipped));
    }

    el.addEventListener('click', toggle);
    el.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      toggle();
    });
  }

  /* ──────────────────── SCROLL REVEALS ──────────────────────────── */

  function initReveals() {
    if (REDUCED) {
      document.documentElement.classList.remove('pa-js');
      return;
    }

    $$('[data-pa-reveal]').forEach(function (el) {
      ScrollTrigger.create({
        trigger: el, start: 'top 90%', once: true,
        onEnter: function () {
          gsap.to(el, {
            opacity: 1, y: 0, duration: 1, ease: 'expo.out',
            startAt: { y: 28 }, clearProps: 'transform'
          });
        }
      });
    });

    $$('[data-pa-stagger]').forEach(function (el) {
      ScrollTrigger.create({
        trigger: el, start: 'top 90%', once: true,
        onEnter: function () {
          gsap.to(el.children, {
            opacity: 1, y: 0, duration: .9, ease: 'power3.out', stagger: .07,
            startAt: { y: 22 }, clearProps: 'transform'
          });
        }
      });
    });

    /* Safety sweep: anything still transparent after the page has
       settled gets shown regardless. A reveal that silently fails to
       fire must never cost the visitor the copy. */
    setTimeout(function () {
      $$('[data-pa-reveal], [data-pa-stagger] > *').forEach(function (el) {
        if (parseFloat(getComputedStyle(el).opacity) < 0.9) {
          gsap.set(el, { opacity: 1, y: 0 });
        }
      });
    }, 6000);
  }

  function initParallax() {
    if (REDUCED) return;
    $$('[data-pa-parallax]').forEach(function (el) {
      gsap.to(el, {
        yPercent: parseFloat(el.getAttribute('data-pa-parallax')) || -5,
        ease: 'none',
        scrollTrigger: { trigger: el, start: 'top bottom', end: 'bottom top', scrub: 1 }
      });
    });
  }

  /* ──────────────────────── CHROME ──────────────────────────────── */

  function initNav() {
    var nav = $('#paNav');
    if (!nav) return;
    ScrollTrigger.create({
      start: 'top -60',
      onToggle: function (self) { nav.classList.toggle('is-stuck', self.isActive); }
    });

    // mark the active landing link while the overview view is scrolled
    var about = $('.pa-nav__link[data-scroll="hero"]');
    if (about) {
      ScrollTrigger.create({
        trigger: '#hero', start: 'top 60%', end: 'bottom top',
        onToggle: function (self) { about.classList.toggle('is-active', self.isActive); }
      });
    }
  }

  /* The chapter HUD is hidden over the hero and over the closing CTA:
     at both ends it would land on a filled surface (the device stage,
     then the onyx panel) and read as a rendering fault. */
  function initHud() {
    var hud = $('#scrollHud');
    if (!hud) return;
    var pastHero = false, atEnd = false;
    function sync() { hud.classList.toggle('is-visible', pastHero && !atEnd); }

    ScrollTrigger.create({
      trigger: '#hero', start: 'bottom 70%',
      onUpdate: function (self) { pastHero = self.progress > 0; sync(); }
    });
    var cta = $('#cta');
    if (cta) {
      ScrollTrigger.create({
        trigger: cta, start: 'top 80%', end: 'max',
        onUpdate: function (self) { atEnd = self.progress > 0; sync(); }
      });
    }
  }

  function initClock() {
    var el = $('#paClock');
    if (!el) return;
    var fmt = new Intl.DateTimeFormat('en-GB', {
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
    });
    function paint() { el.textContent = fmt.format(new Date()); }
    paint();
    setInterval(paint, 1000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { boot(); initFlip(); });
  } else {
    boot(); initFlip();
  }
})();
