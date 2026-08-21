/* ══════════════════════════════════════════════════════════════════
   PEAR ATELIER · interaction + WebGL runtime
   ------------------------------------------------------------------
   One clock drives everything. GSAP's ticker advances Lenis, the
   three.js frame and the cursor lerp in that order, so scroll offset,
   camera framing and cursor position are all sampled from the same
   instant — which is what stops the 3D from lagging a frame behind
   the DOM during fast scrolls.
   ══════════════════════════════════════════════════════════════════ */

const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp  = (a, b, t) => a + (b - a) * t;

/* Frame-rate independent smoothing. A raw `a += (b-a)*0.1` per frame
   settles twice as fast at 120Hz as at 60Hz; this doesn't. */
const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));

/* The CDN bundles are `defer`, this module is deferred too, so in
   practice they're parsed first — but a slow CDN shouldn't take the
   whole page down with it. */
function whenGlobals(names, timeout = 6000) {
  return new Promise((resolve) => {
    const t0 = performance.now();
    (function poll() {
      if (names.every((n) => window[n])) return resolve(true);
      if (performance.now() - t0 > timeout) return resolve(false);
      requestAnimationFrame(poll);
    })();
  });
}

/* ═════════════════════════ 1 · BOOTSTRAP ═════════════════════════ */

let lenis = null;
const frameTasks = [];
const onFrame = (fn) => frameTasks.push(fn);

async function boot() {
  const hasGsap = await whenGlobals(['gsap', 'ScrollTrigger']);

  if (hasGsap) {
    gsap.registerPlugin(ScrollTrigger);
    gsap.ticker.lagSmoothing(0);
  }

  /* ── smooth scroll ─────────────────────────────────────────────
     Lenis owns the wheel; ScrollTrigger reads the same native
     scrollTop Lenis writes, so no scrollerProxy is required. */
  if (window.Lenis && !REDUCED) {
    lenis = new Lenis({
      duration: 1.15,
      easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
      smoothWheel: true,
      wheelMultiplier: 1,
      touchMultiplier: 1.6,
    });
    if (hasGsap) lenis.on('scroll', ScrollTrigger.update);
  }

  /* one ticker to rule them: lenis → tasks (three, cursor, carousel) */
  let last = performance.now();
  const tick = (timeSec) => {
    const now = timeSec !== undefined ? timeSec * 1000 : performance.now();
    const dt = clamp((now - last) / 1000, 0, 0.064); // cap after tab-out
    last = now;
    if (lenis) lenis.raf(now);
    for (let i = 0; i < frameTasks.length; i++) frameTasks[i](dt, now / 1000);
  };

  if (hasGsap) gsap.ticker.add(tick);
  else (function raf() { tick(); requestAnimationFrame(raf); })();

  /* ── modules ───────────────────────────────────────────────────
     Order matters only for the preloader, which needs to know what
     it is waiting on. Everything else is independent. */
  initCursor();
  initClock();
  initSound();
  initCompare();
  initCarousel();
  if (hasGsap) {
    initReveals();
    initChapters();
    initCounters();
    initMagnetic();
    initNavState();
  } else {
    document.documentElement.classList.remove('js');
  }

  const stageReady = initStage();          // WebGL, fails soft
  initPreloader(stageReady, hasGsap);
}

/* ════════════════════════ 2 · PRELOADER ══════════════════════════ */

function initPreloader(stageReady, hasGsap) {
  const el = $('#preloader');
  const num = $('#preNum');
  const bar = $('#preBar');
  if (!el) return;

  const finish = () => {
    document.documentElement.classList.add('is-loaded');
    $('#stage')?.classList.add('is-ready');
    if (hasGsap) ScrollTrigger.refresh();
    document.dispatchEvent(new CustomEvent('atelier:ready'));
  };

  if (REDUCED || !hasGsap) {
    el.remove();
    finish();
    return;
  }

  /* Real signals, not a fake timer: fonts decide whether the headline
     reflows, and the WebGL promise decides whether the curtain lifts
     onto an empty stage. */
  const signals = Promise.all([
    new Promise((r) => (document.readyState === 'complete'
      ? r() : window.addEventListener('load', r, { once: true }))),
    document.fonts ? document.fonts.ready : Promise.resolve(),
    stageReady,
  ]);

  const state = { v: 0 };
  let settled = false;
  signals.then(() => { settled = true; });

  /* Creep to 90 on a curve, then let the real signals carry the last
     10 — a bar that sits at 99% reads as broken. */
  const crawl = gsap.to(state, {
    v: 90, duration: 2.4, ease: 'power2.out',
    onUpdate: paint,
  });

  function paint() {
    const v = Math.round(state.v);
    num.textContent = v;
    bar.style.width = v + '%';
  }

  const watch = () => {
    if (settled) {
      crawl.kill();
      gsap.to(state, {
        v: 100, duration: 0.55, ease: 'power2.inOut', onUpdate: paint,
        onComplete: lift,
      });
      return;
    }
    requestAnimationFrame(watch);
  };
  requestAnimationFrame(watch);

  function lift() {
    gsap.timeline({ onComplete: () => { el.remove(); ScrollTrigger.refresh(); } })
      .to(el, { yPercent: -101, duration: 1.05, ease: 'expo.inOut' }, 0)
      .add(finish, 0.35)
      /* fromTo, not from: the stylesheet already parks these at
         opacity 0, and a relative .from() would animate 0 → 0. */
      .fromTo('.hero__copy .line > span',
        { yPercent: 108 },
        { yPercent: 0, duration: 1.15, stagger: 0.075, ease: 'expo.out' }, 0.45)
      .fromTo('.hero__copy .eyebrow, .hero .lede',
        { opacity: 0, y: 24 },
        { opacity: 1, y: 0, duration: 1, stagger: 0.1, ease: 'expo.out', clearProps: 'transform' }, 0.55)
      .fromTo('.hero__actions > *, .proof li',
        { opacity: 0, y: 22 },
        { opacity: 1, y: 0, duration: .8, stagger: .05, ease: 'power3.out', clearProps: 'transform' }, 0.85)
      .fromTo('.hero__widget',
        { opacity: 0, y: 46, scale: .97 },
        { opacity: 1, y: 0, scale: 1, duration: 1.2, ease: 'expo.out', clearProps: 'transform' }, 0.7);
  }
}

/* ═══════════════════ 3 · CURSOR + MAGNETIC HOVER ═════════════════ */

function initCursor() {
  const root  = $('#cursor');
  const dot   = $('#cursorDot');
  const ring  = $('#cursorRing');
  const label = $('#cursorLabel');
  if (!root || REDUCED || !matchMedia('(hover: hover) and (pointer: fine)').matches) return;

  const p = { x: innerWidth / 2, y: innerHeight / 2 };
  const d = { x: p.x, y: p.y };   // dot — tight
  const r = { x: p.x, y: p.y };   // ring — lagging, gives the trail weight
  let snap = null;                // magnetic target the ring locks onto

  addEventListener('pointermove', (e) => { p.x = e.clientX; p.y = e.clientY; }, { passive: true });
  addEventListener('pointerdown', () => root.classList.add('is-down'));
  addEventListener('pointerup',   () => root.classList.remove('is-down'));
  addEventListener('pointerleave', () => gsap.to(root, { opacity: 0, duration: .3 }));
  addEventListener('pointerenter', () => gsap.to(root, { opacity: 1, duration: .3 }));

  onFrame((dt) => {
    d.x = damp(d.x, p.x, 34, dt);
    d.y = damp(d.y, p.y, 34, dt);

    /* When a magnetic element is hovered the ring stops chasing the
       pointer and eases toward the element's centre instead — that
       snap is the whole "the button caught it" sensation. */
    const tx = snap ? snap.x : p.x;
    const ty = snap ? snap.y : p.y;
    r.x = damp(r.x, tx, snap ? 16 : 11, dt);
    r.y = damp(r.y, ty, snap ? 16 : 11, dt);

    dot.style.transform  = `translate3d(${d.x}px, ${d.y}px, 0) translate(-50%, -50%)`;
    ring.style.transform = `translate3d(${r.x}px, ${r.y}px, 0) translate(-50%, -50%)`;
  });

  /* Delegated so carousel cards cloned or re-ordered later still work */
  const hoverSel = 'a, button, [data-cursor-hover]';
  const badgeSel = '[data-cursor-badge]';

  document.addEventListener('pointerover', (e) => {
    const badge = e.target.closest?.(badgeSel);
    const hover = e.target.closest?.(hoverSel);
    if (badge) {
      label.textContent = badge.dataset.cursorBadge;
      root.classList.add('is-badge');
      root.classList.remove('is-hover');
      snap = null;
    } else if (hover) {
      root.classList.add('is-hover');
      root.classList.remove('is-badge');
      snap = centreOf(hover);
      hover.__snapEl = true;
    }
  });

  document.addEventListener('pointerout', (e) => {
    if (e.relatedTarget && e.target.contains?.(e.relatedTarget)) return;
    if (e.target.closest?.(badgeSel)) root.classList.remove('is-badge');
    if (e.target.closest?.(hoverSel)) { root.classList.remove('is-hover'); snap = null; }
  });

  /* Recompute the snap point while the pointer travels across a wide
     button, otherwise the ring parks on a stale centre after scroll. */
  document.addEventListener('pointermove', (e) => {
    if (!snap) return;
    const el = e.target.closest?.(hoverSel);
    snap = el ? centreOf(el) : null;
  }, { passive: true });

  function centreOf(el) {
    const b = el.getBoundingClientRect();
    return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
  }
}

/* Magnetic pull on the element itself — the cursor snapping to the
   button and the button leaning toward the cursor are two halves of
   the same effect; either one alone feels broken. */
function initMagnetic() {
  if (REDUCED || !matchMedia('(hover: hover) and (pointer: fine)').matches) return;

  $$('.magnetic').forEach((el) => {
    const xTo = gsap.quickTo(el, 'x', { duration: .6, ease: 'power3' });
    const yTo = gsap.quickTo(el, 'y', { duration: .6, ease: 'power3' });

    el.addEventListener('pointermove', (e) => {
      const b = el.getBoundingClientRect();
      xTo((e.clientX - b.left - b.width  / 2) * 0.26);
      yTo((e.clientY - b.top  - b.height / 2) * 0.42);
    });
    el.addEventListener('pointerleave', () => { xTo(0); yTo(0); });
  });
}

/* ═════════════════ 4 · KINETIC TYPE + SCROLL REVEALS ═════════════ */

function initReveals() {
  if (REDUCED) return;

  /* The hero is choreographed by the preloader's exit timeline, so it
     is excluded here — two systems animating the same nodes is how you
     get a headline that opens twice or never arrives at all. */
  const notHero = (el) => !el.closest('.hero');

  /* Headlines are pre-split into .line > span in the markup — no
     runtime text surgery, so screen readers and copy-paste get the
     sentence intact and there is no reflow on font swap. */
  $$('[data-split="lines"]').filter(notHero).forEach((h) => {
    const spans = $$('.line > span', h);
    if (!spans.length) return;
    gsap.set(spans, { yPercent: 108 });
    ScrollTrigger.create({
      trigger: h, start: 'top 88%', once: true,
      onEnter: () => gsap.to(spans, {
        yPercent: 0, duration: 1.15, ease: 'expo.out', stagger: 0.075,
      }),
    });
  });

  $$('[data-reveal]').filter(notHero).forEach((el) => {
    ScrollTrigger.create({
      trigger: el, start: 'top 90%', once: true,
      onEnter: () => gsap.to(el, {
        opacity: 1, y: 0, duration: 1, ease: 'expo.out',
        startAt: { y: 26 }, clearProps: 'transform',
      }),
    });
  });

  $$('[data-stagger]').filter(notHero).forEach((el) => {
    ScrollTrigger.create({
      trigger: el, start: 'top 90%', once: true,
      onEnter: () => gsap.to(el.children, {
        opacity: 1, y: 0, duration: .9, ease: 'power3.out', stagger: .07,
        startAt: { y: 20 }, clearProps: 'transform',
      }),
    });
  });

  /* Parallax on the elevated cards — small offsets only. Anything
     past ~10% and the shadow stops agreeing with the light source. */
  const drift = (sel, amount) => $$(sel).forEach((el) => {
    gsap.to(el, {
      yPercent: amount, ease: 'none',
      scrollTrigger: { trigger: el, start: 'top bottom', end: 'bottom top', scrub: 1 },
    });
  });
  drift('.hero__widget', -7);
  drift('.compare', -4);

  /* Step activation drives both the left-column readout and the
     3D fabric drape value. */
  const drape = $('#roDrape');
  $$('[data-step]').forEach((step, i) => {
    ScrollTrigger.create({
      trigger: step, start: 'top 62%', end: 'bottom 45%',
      onToggle: (self) => {
        step.classList.toggle('is-active', self.isActive);
        if (self.isActive && drape) drape.textContent = (0.42 + i * 0.13).toFixed(2);
      },
    });
  });
}

/* ═════════════════════ 5 · CHAPTER HUD + NAV ═════════════════════ */

function initChapters() {
  const items = $$('.hud__item');
  const byName = new Map(items.map((el) => [el.dataset.hud, el]));

  /* The rail is hidden at both ends of the page: over the hero the
     widget card reaches the right gutter, and over the closing CTA the
     onyx panel does — in both cases the rail lands on top of a filled
     surface and reads as a rendering fault rather than a control. */
  const hud = $('#hud');
  let pastHero = false, atEnd = false;
  const sync = () => hud?.classList.toggle('is-visible', pastHero && !atEnd);

  ScrollTrigger.create({
    trigger: '.hero', start: 'bottom 70%',
    onUpdate: (self) => { pastHero = self.progress > 0; sync(); },
  });
  ScrollTrigger.create({
    trigger: '#start', start: 'top 80%', end: 'max',
    onUpdate: (self) => { atEnd = self.progress > 0; sync(); },
  });

  $$('[data-chapter]').forEach((sec) => {
    ScrollTrigger.create({
      trigger: sec, start: 'top 55%', end: 'bottom 55%',
      onToggle: (self) => {
        byName.get(sec.dataset.chapter)?.classList.toggle('is-active', self.isActive);
      },
    });
  });

  /* Anchor links have to route through Lenis or they hard-jump and
     desync every ScrollTrigger that was mid-scrub. */
  $$('a[href^="#"]').forEach((a) => {
    a.addEventListener('click', (e) => {
      const id = a.getAttribute('href');
      if (id === '#' || !id) return;
      const target = document.querySelector(id);
      if (!target) return;
      e.preventDefault();
      if (lenis) lenis.scrollTo(target, { offset: -20, duration: 1.4 });
      else target.scrollIntoView({ behavior: REDUCED ? 'auto' : 'smooth' });
    });
  });
}

function initNavState() {
  const nav = $('#nav');
  ScrollTrigger.create({
    start: 'top -60',
    onToggle: (self) => nav.classList.toggle('is-stuck', self.isActive),
  });

  const links = $$('.nav__link');
  const map = { experience: 'Experience', technology: 'Technology', collection: 'Collection' };
  $$('[data-chapter]').forEach((sec) => {
    const name = map[sec.dataset.chapter];
    if (!name) return;
    const link = links.find((l) => l.textContent.trim() === name);
    if (!link) return;
    ScrollTrigger.create({
      trigger: sec, start: 'top 55%', end: 'bottom 55%',
      onToggle: (self) => link.classList.toggle('is-active', self.isActive),
    });
  });
}

/* ══════════════════════════ 6 · COUNTERS ═════════════════════════ */

function initCounters() {
  $$('[data-count]').forEach((el) => {
    const to = parseFloat(el.dataset.count);
    const from = parseFloat(el.textContent) || 0;
    const prefix = el.dataset.prefix || '';
    const state = { v: from };
    el.textContent = prefix + from;

    ScrollTrigger.create({
      trigger: el, start: 'top 88%', once: true,
      onEnter: () => gsap.to(state, {
        v: to, duration: 1.8, ease: 'expo.out',
        onUpdate: () => { el.textContent = prefix + Math.round(state.v); },
      }),
    });
  });
}

/* ═══════════ 7 · PHYSICAL ↔ VIRTUAL COMPARISON SLIDER ════════════ */

function initCompare() {
  const root   = $('#compare');
  const pane   = $('#comparePane');
  const handle = $('#compareHandle');
  const range  = $('#compareRange');
  if (!root || !pane) return;

  let target = 50, current = 50, dragging = false;

  const apply = (v) => {
    pane.style.clipPath = `inset(0 0 0 ${v}%)`;
    handle.style.left = v + '%';
  };
  apply(50);

  const fromEvent = (e) => {
    const b = root.getBoundingClientRect();
    target = clamp(((e.clientX - b.left) / b.width) * 100, 0, 100);
    if (range) range.value = Math.round(target);
  };

  root.addEventListener('pointerdown', (e) => {
    dragging = true;
    root.classList.add('is-dragging');
    root.setPointerCapture?.(e.pointerId);
    fromEvent(e);
  });
  root.addEventListener('pointermove', (e) => { if (dragging) fromEvent(e); });
  const end = (e) => {
    if (!dragging) return;
    dragging = false;
    root.classList.remove('is-dragging');
    root.releasePointerCapture?.(e.pointerId);
  };
  root.addEventListener('pointerup', end);
  root.addEventListener('pointercancel', end);

  /* Hover-scrub when idle: the affordance reads before anyone commits
     to a drag. Disabled the moment a real drag starts. */
  root.addEventListener('pointermove', (e) => {
    if (!dragging && e.pointerType === 'mouse') fromEvent(e);
  }, { passive: true });

  /* Keyboard parity through the visually-hidden range input. */
  range?.addEventListener('input', () => { target = parseFloat(range.value); });

  onFrame((dt) => {
    if (Math.abs(current - target) < 0.02) return;
    current = damp(current, target, 14, dt);
    apply(current);
  });
}

/* ═══════════════ 8 · DRAG CAROUSEL WITH INERTIA ══════════════════ */

function initCarousel() {
  const gallery = $('#collection');
  const track   = $('#track');
  const thumb   = $('#railThumb');
  if (!track) return;

  let target = 0, current = 0, maxScroll = 0;
  let dragging = false, startX = 0, startTarget = 0;
  let vel = 0, lastX = 0, lastT = 0;

  /* Measured from the children's own rects rather than scrollWidth.
     Both ends carry the same live translate so the span between them
     is transform-invariant, which means measuring mid-throw is safe. */
  const measure = () => {
    const kids = track.children;
    if (!kids.length) return;
    const first = kids[0].getBoundingClientRect();
    const last  = kids[kids.length - 1].getBoundingClientRect();
    const gutter = parseFloat(getComputedStyle(track).paddingInlineStart) || 0;
    maxScroll = Math.max(0, (last.right - first.left) + gutter * 2 - track.clientWidth);
    target = clamp(target, -maxScroll, 0);
  };
  measure();
  addEventListener('resize', measure);
  document.addEventListener('atelier:ready', measure);

  track.addEventListener('pointerdown', (e) => {
    dragging = true;
    gallery.classList.add('is-dragging');
    track.setPointerCapture?.(e.pointerId);
    startX = lastX = e.clientX;
    startTarget = target;
    vel = 0;
    lastT = performance.now();
  });

  track.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    e.preventDefault();
    target = clamp(startTarget + (e.clientX - startX), -maxScroll, 0);

    const now = performance.now();
    const dt = now - lastT;
    if (dt > 0) vel = ((e.clientX - lastX) / dt) * 16; // px per ~frame
    lastX = e.clientX;
    lastT = now;
  });

  const release = (e) => {
    if (!dragging) return;
    dragging = false;
    gallery.classList.remove('is-dragging');
    track.releasePointerCapture?.(e.pointerId);
    /* Throw: velocity carries roughly a dozen frames of travel, then
       the clamp absorbs whatever overshoots the ends. */
    target = clamp(target + vel * 12, -maxScroll, 0);
  };
  track.addEventListener('pointerup', release);
  track.addEventListener('pointercancel', release);

  /* Trackpads emit horizontal deltas Lenis deliberately ignores —
     claim them here so a two-finger swipe scrolls the rail. */
  track.addEventListener('wheel', (e) => {
    if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
    e.preventDefault();
    target = clamp(target - e.deltaX, -maxScroll, 0);
  }, { passive: false });

  /* A drag that travelled shouldn't also fire the card's click. */
  track.addEventListener('click', (e) => {
    if (Math.abs(target - startTarget) > 6) { e.preventDefault(); e.stopPropagation(); }
  }, true);

  onFrame((dt) => {
    current = damp(current, target, 9, dt);
    track.style.transform = `translate3d(${current.toFixed(2)}px,0,0)`;
    if (thumb && maxScroll > 0) {
      /* translateX on the thumb is a percentage of its OWN width, so
         the travel has to be re-expressed in those units. */
      const ratio = clamp(track.clientWidth / (track.clientWidth + maxScroll), 0.08, 1);
      const p = clamp(-current / maxScroll, 0, 1);
      thumb.style.width = (ratio * 100) + '%';
      thumb.style.transform = `translateX(${(p * (1 - ratio) / ratio) * 100}%)`;
    }
  });
}

/* ═══════════════════ 9 · GENERATIVE SOUND LAYER ══════════════════ */

/* No audio file to ship, no media-src to widen: a filtered two-voice
   pad plus a noise bed, synthesised on the first user gesture. */
function initSound() {
  const btn = $('#sound');
  const state = $('#soundState');
  if (!btn) return;

  let ctx = null, master = null, on = false;

  const build = () => {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    ctx = new AC();

    master = ctx.createGain();
    master.gain.value = 0;
    master.connect(ctx.destination);

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 520;
    filter.Q.value = 0.8;
    filter.connect(master);

    // two detuned voices a fifth apart — enough motion to feel alive,
    // few enough partials to sit under a voiceover if one is ever added
    [110, 164.81].forEach((hz, i) => {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = hz;
      osc.detune.value = i ? 6 : -6;
      const g = ctx.createGain();
      g.gain.value = i ? 0.22 : 0.3;
      osc.connect(g).connect(filter);
      osc.start();
    });

    // air: two seconds of looping noise through a narrow bandpass
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * 0.4;
    const noise = ctx.createBufferSource();
    noise.buffer = buf;
    noise.loop = true;
    const nb = ctx.createBiquadFilter();
    nb.type = 'bandpass';
    nb.frequency.value = 1400;
    nb.Q.value = 0.7;
    const ng = ctx.createGain();
    ng.gain.value = 0.05;
    noise.connect(nb).connect(ng).connect(master);
    noise.start();

    // slow filter sweep so the pad never sits still
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.05;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 220;
    lfo.connect(lfoGain).connect(filter.frequency);
    lfo.start();

    return true;
  };

  btn.addEventListener('click', () => {
    if (!ctx && !build()) { btn.disabled = true; return; }
    ctx.resume?.();
    on = !on;
    btn.classList.toggle('is-on', on);
    btn.setAttribute('aria-pressed', String(on));
    state.textContent = on ? 'On' : 'Off';
    master.gain.cancelScheduledValues(ctx.currentTime);
    master.gain.setTargetAtTime(on ? 0.06 : 0, ctx.currentTime, on ? 0.6 : 0.35);
  });

  /* A short blip on interactive hover, only while sound is armed. */
  document.addEventListener('pointerover', (e) => {
    if (!on || !ctx || !e.target.closest?.('a, button, [data-cursor-hover]')) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(1180, t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.035, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    o.connect(g).connect(master);
    o.start(t);
    o.stop(t + 0.18);
  });

  addEventListener('visibilitychange', () => {
    if (!ctx || !on) return;
    master.gain.setTargetAtTime(document.hidden ? 0 : 0.06, ctx.currentTime, 0.25);
  });
}

/* ══════════════════════════ 10 · CLOCK ═══════════════════════════ */

function initClock() {
  const local  = $('#clockLocal');
  const studio = $('#clockStudio');
  const tzName = $('#tzName');
  $('#year') && ($('#year').textContent = new Date().getFullYear());
  if (!local) return;

  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (tzName && tz) tzName.textContent = tz.split('/').pop().replace(/_/g, ' ');

  const fmt = (zone) => new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false, timeZone: zone,
  });
  const here = fmt(undefined);
  const there = fmt('Asia/Jerusalem');

  const paint = () => {
    const now = new Date();
    local.textContent = here.format(now);
    studio.textContent = there.format(now);
  };
  paint();
  setInterval(paint, 1000);
}

/* ══════════════════ 11 · WEBGL ATELIER (three.js) ════════════════ */

/* Returns a promise that always resolves — the preloader waits on it,
   and a machine without WebGL should still see the curtain lift. */
function initStage() {
  return new Promise((resolve) => {
    const host = $('#stage');
    if (!host) return resolve(false);

    buildStage(host).then(resolve).catch((err) => {
      console.warn('[atelier] WebGL stage unavailable:', err);
      host.remove();
      resolve(false);
    });
  });
}

async function buildStage(host) {
  const THREE = await import('three');
  const { RoomEnvironment } = await import('three/addons/environments/RoomEnvironment.js');

  const narrow = () => innerWidth < 1100;
  const lowPower = narrow() || (navigator.hardwareConcurrency || 8) <= 4;

  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: !lowPower, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, lowPower ? 1.4 : 1.75));
  renderer.setSize(innerWidth, innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.04;
  host.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, innerWidth / innerHeight, 0.1, 100);
  camera.position.set(0, 0, 9);

  /* RoomEnvironment gives real specular reflections with no HDR file
     to fetch — which matters here, since the CSP only opens img-src
     to 'self' and a .hdr would need a new origin. */
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(renderer), 0.04).texture;

  /* The environment is doing most of the lighting. These two are for
     shaping only — pushed harder and the beige fabrics blow out to
     white under ACES, which is exactly what makes CG cloth read as
     paper instead of silk. */
  const key = new THREE.DirectionalLight(0xffffff, 0.9);
  key.position.set(3.2, 4.5, 5);
  scene.add(key);

  const rim = new THREE.DirectionalLight(0x9bb53a, 0.85);
  rim.position.set(-4, 1.5, -3);
  scene.add(rim);

  scene.add(new THREE.AmbientLight(0xf4f1ea, 0.3));

  /* ── the group everything is framed by ─────────────────────────── */
  const atelier = new THREE.Group();
  scene.add(atelier);

  /* Deliberately a shade under the CSS hexes: ACES tone mapping plus a
     bright environment lifts everything, so feeding it the literal
     #E5E1D6 comes back as white. These land on the CSS values. */
  const PALETTE = {
    linen: 0xc9c3b1,
    onyx:  0x101010,
    pear:  0x7f9a2a,
    white: 0xe8e4dc,
  };

  /* ── 1 · silk drape ───────────────────────────────────────────── */
  const clothUniforms = {
    uTime: { value: 0 },
    uAmp:  { value: 1 },
  };

  const makeCloth = (w, h, color, opts = {}) => {
    const seg = lowPower ? 28 : 68;
    const geo = new THREE.PlaneGeometry(w, h, seg, Math.round(seg * (h / w)));
    const mat = new THREE.MeshPhysicalMaterial({
      color,
      roughness: opts.roughness ?? 0.58,
      metalness: 0,
      sheen: 1,
      sheenRoughness: 0.42,
      sheenColor: new THREE.Color(0xffffff),
      clearcoat: opts.clearcoat ?? 0.16,
      clearcoatRoughness: 0.5,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: opts.opacity ?? 1,
    });

    /* Displace in the vertex stage and rebuild the normal from the
       displaced surface. Doing it here rather than with a bespoke
       ShaderMaterial keeps the PBR lighting and the environment
       reflection — which is the entire reason the silk reads as silk. */
    const amp = opts.amp ?? 1;
    const phase = opts.phase ?? 0;
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = clothUniforms.uTime;
      shader.uniforms.uAmp = clothUniforms.uAmp;
      shader.uniforms.uLocalAmp = { value: amp };
      shader.uniforms.uPhase = { value: phase };

      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', /* glsl */`
          #include <common>
          uniform float uTime;
          uniform float uAmp;
          uniform float uLocalAmp;
          uniform float uPhase;

          vec3 drape(vec3 p) {
            float t = uTime + uPhase;
            // four octaves: two slow rolls for the main fold, two fast
            // ones for the creases that catch the specular highlight
            float w =
                sin(p.x * 1.55 + t * 0.75) * 0.42
              + sin(p.y * 2.10 - t * 0.55) * 0.30
              + sin((p.x + p.y) * 3.40 + t * 1.05) * 0.14
              + sin(p.y * 5.60 + t * 0.35) * 0.07;
            // the hem hangs looser than the shoulder
            float sag = smoothstep(1.2, -1.2, p.y);
            p.z += w * uAmp * uLocalAmp * (0.55 + sag * 0.75);
            return p;
          }
        `)
        .replace('#include <beginnormal_vertex>', /* glsl */`
          vec3 dPos  = drape(position);
          vec3 dPosX = drape(position + vec3(0.02, 0.0, 0.0));
          vec3 dPosY = drape(position + vec3(0.0, 0.02, 0.0));
          vec3 objectNormal = normalize(cross(dPosX - dPos, dPosY - dPos));
          #ifdef USE_TANGENT
            vec3 objectTangent = vec3(tangent.xyz);
          #endif
        `)
        .replace('#include <begin_vertex>', 'vec3 transformed = dPos;');
    };

    return new THREE.Mesh(geo, mat);
  };

  /* Local layout rule for this group: the pear sits ON the origin, and
     everything else is placed relative to it. That is what lets a
     chapter's single `x` value aim the composition — with the subject
     parked off-origin, every act would need its own hand-tuned offset. */
  const drape = makeCloth(2.9, 3.9, PALETTE.linen, { amp: 1 });
  drape.position.set(0.85, 0.15, -1.6);
  drape.rotation.set(-0.06, 0.28, 0.05);
  atelier.add(drape);

  /* small satellite swatches — the rest of the colourway, floating */
  const swatchMeshes = [
    { mesh: makeCloth(0.95, 1.30, PALETTE.onyx,  { amp: 1.5, phase: 2.1, roughness: .5 }),  pos: [-1.35,  1.55, 0.3],  rot: [0.10, -0.50, -0.22] },
    { mesh: makeCloth(0.80, 1.10, PALETTE.pear,  { amp: 1.8, phase: 4.4, roughness: .45 }), pos: [ 1.45, -1.35, 0.7],  rot: [-0.12, 0.45,  0.30] },
    { mesh: makeCloth(0.72, 1.00, PALETTE.white, { amp: 1.6, phase: 6.2, roughness: .4 }),  pos: [ 1.75,  1.60, -0.4], rot: [0.16,  0.30, -0.35] },
  ];
  swatchMeshes.forEach(({ mesh, pos, rot }) => {
    mesh.position.set(...pos);
    mesh.rotation.set(...rot);
    atelier.add(mesh);
  });

  /* ── 2 · chrome hanger ────────────────────────────────────────── */
  const chrome = new THREE.MeshPhysicalMaterial({
    color: 0xdfe1e4,
    metalness: 1,
    roughness: 0.14,
    envMapIntensity: 1.7,
    clearcoat: 1,
    clearcoatRoughness: 0.08,
  });

  const hanger = new THREE.Group();
  const tube = (points, radius = 0.035) => {
    const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)));
    return new THREE.Mesh(
      new THREE.TubeGeometry(curve, lowPower ? 26 : 64, radius, lowPower ? 6 : 12, false),
      chrome
    );
  };

  // shoulders: a shallow V with softened corners
  hanger.add(tube([[-1.15, -0.42, 0], [-0.6, -0.16, 0], [0, 0.02, 0], [0.6, -0.16, 0], [1.15, -0.42, 0]]));
  // bottom bar
  hanger.add(tube([[-1.13, -0.44, 0], [0, -0.5, 0], [1.13, -0.44, 0]], 0.028));
  // neck
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.26, 12), chrome);
  neck.position.set(0, 0.15, 0);
  hanger.add(neck);
  // hook
  const hook = new THREE.Mesh(
    new THREE.TorusGeometry(0.19, 0.032, 10, lowPower ? 22 : 48, Math.PI * 1.45),
    chrome
  );
  hook.position.set(0, 0.46, 0);
  hook.rotation.z = -Math.PI * 0.28;
  hanger.add(hook);

  hanger.position.set(-0.2, 1.55, 0.5);
  hanger.rotation.set(0.12, -0.35, 0.16);
  hanger.scale.setScalar(0.9);
  atelier.add(hanger);

  /* ── 3 · the pear ─────────────────────────────────────────────── */
  /* Lathed from the brand silhouette: wide bulb low, long neck high.
     The profile is smoothed through a spline so the shoulder between
     bulb and neck stays continuous — a raw point list facets there. */
  const profile = [
    [0.001, -1.00], [0.34, -0.94], [0.62, -0.76], [0.76, -0.46],
    [0.78, -0.14], [0.66,  0.14], [0.48,  0.38], [0.34,  0.60],
    [0.25,  0.80], [0.19,  0.94], [0.12,  1.02], [0.001, 1.05],
  ].map(([x, y]) => new THREE.Vector3(x, y, 0));

  const lathePoints = new THREE.CatmullRomCurve3(profile, false, 'catmullrom', 0.4)
    .getPoints(lowPower ? 30 : 72)
    .map((p) => new THREE.Vector2(Math.max(p.x, 0.001), p.y));

  const pearMat = new THREE.MeshPhysicalMaterial({
    color: PALETTE.pear,
    roughness: 0.28,
    metalness: 0.05,
    clearcoat: 1,
    clearcoatRoughness: 0.14,
    sheen: 0.4,
    sheenColor: new THREE.Color(0xffffff),
    envMapIntensity: 1.15,
  });

  const pear = new THREE.Group();
  const pearBody = new THREE.Mesh(
    new THREE.LatheGeometry(lathePoints, lowPower ? 40 : 96),
    pearMat
  );
  pear.add(pearBody);

  const darkMat = new THREE.MeshPhysicalMaterial({
    color: PALETTE.onyx, roughness: 0.35, metalness: 0.1, clearcoat: .6,
  });

  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.04, 0.34, 10), darkMat);
  stem.position.set(0.02, 1.18, 0);
  stem.rotation.z = -0.18;
  pear.add(stem);

  // leaf: a squashed sphere reads better than a plane at grazing angles
  const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.2, 20, 14), darkMat);
  leaf.scale.set(1, 0.4, 0.1);
  leaf.position.set(0.21, 1.27, 0.02);
  leaf.rotation.set(0, 0, 0.66);
  pear.add(leaf);

  pear.position.set(0, -0.35, 0.9);
  pear.scale.setScalar(0.68);
  atelier.add(pear);

  /* ── 4 · contact shadow ───────────────────────────────────────── */
  /* A painted radial gradient on a plane. Real shadow maps here would
     cost a second render pass for a blur nobody would look at twice. */
  const shadowTex = (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, 'rgba(13,13,13,0.34)');
    grad.addColorStop(0.55, 'rgba(13,13,13,0.10)');
    grad.addColorStop(1, 'rgba(13,13,13,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(c);
  })();

  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(1.9, 1.9),
    new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false })
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.set(0, -1.06, 0.9);
  atelier.add(shadow);

  /* ── colourway switching ──────────────────────────────────────── */
  /* One control recolours the drape and the pear together, so the
     swatch reads as "this is the fabric" rather than "this tints a ball". */
  const roFabric = $('#roFabric');
  const roFit = $('#roFit');
  const FITS = { linen: 'M', onyx: 'L', pear: 'S', white: 'M' };

  /* The swatches dress the garment, not the fruit. The pear is the
     brand mark — recolouring it to "Onyx" would leave the page with no
     green in the 3D layer at all, which is the one thing the accent
     colour exists to guarantee. */
  const FABRIC_NAME = { linen: 'Linen', onyx: 'Onyx', pear: 'Pear', white: 'Cotton' };

  const setColourway = (name) => {
    const target = new THREE.Color(PALETTE[name] ?? PALETTE.linen);
    gsap.to(drape.material.color, {
      r: target.r, g: target.g, b: target.b, duration: .8, ease: 'power2.out',
    });
    gsap.to(drape.material, {
      // dark cloth needs a tighter specular or it reads as flat black;
      // white needs a looser one or it clips
      roughness: name === 'onyx' ? 0.4 : name === 'white' ? 0.52 : 0.58,
      clearcoat: name === 'onyx' ? 0.45 : 0.16,
      duration: .8, ease: 'power2.out',
    });
    if (roFabric) roFabric.textContent = FABRIC_NAME[name] || 'Linen';
    if (roFit) roFit.textContent = FITS[name] || 'M';
  };

  $$('.swatch').forEach((btn) => {
    btn.addEventListener('click', () => {
      $$('.swatch').forEach((b) => {
        b.classList.toggle('is-active', b === btn);
        b.setAttribute('aria-pressed', String(b === btn));
      });
      setColourway(btn.dataset.colour);
    });
  });

  /* ── framing per chapter ──────────────────────────────────────── */
  /* The scene never unmounts; each chapter just re-frames it. Values
     are targets, not applied transforms — the frame loop eases toward
     them, so a fast scroll through three chapters still arrives
     smoothly instead of snapping between keyframes. */
  /* x is roughly "which column am I standing in" at this camera:
     ±2.7 lands on a half-column edge, ±4 is off the side of the page.
     The hero sits right and slightly back so the headline keeps clean
     beige under it; the try-on chapter brings the group forward into
     the left column, where the vitrine frames it. */
  const ACTS = {
    main:       { x:  0.60, y: -0.10, z: -1.6, rx:  0.05, ry: -0.50, rz:  0.04, s: 0.95, o: 0.92 },
    experience: { x: -2.00, y: -0.10, z:  0.4, rx:  0.00, ry:  0.32, rz: -0.03, s: 1.10, o: 1.00 },
    overlay:    { x:  3.40, y:  0.40, z: -2.5, rx:  0.08, ry: -0.90, rz:  0.08, s: 0.85, o: 0.38 },
    technology: { x: -3.80, y:  0.50, z: -4.0, rx:  0.06, ry:  1.00, rz: -0.10, s: 0.75, o: 0.24 },
    collection: { x:  3.90, y: -0.50, z: -4.5, rx: -0.05, ry: -1.30, rz:  0.10, s: 0.70, o: 0.20 },
    start:      { x:  0.00, y:  0.10, z: -2.2, rx:  0.00, ry:  0.35, rz:  0.00, s: 1.00, o: 0.65 },
  };

  /* On a narrow viewport there are no side columns to sit beside, so
     the group centres and drops back instead of sliding off-screen. */
  const actFor = (name) => {
    const a = { ...ACTS[name] };
    if (narrow()) {
      /* One column means the composition has nowhere to stand beside
         the text — it goes behind it, further back and much fainter,
         because a glossy pear at full opacity under a paragraph costs
         more legibility than the atmosphere is worth. */
      a.x *= 0.28;
      a.z -= 1.6;
      a.s *= 0.82;
      // the try-on chapter is the exception: there the frame is on
      // screen specifically to be looked through
      a.o *= (name === 'experience' ? 0.78 : 0.42);
    }
    return a;
  };

  let currentChapter = 'main';
  const goal = actFor('main');
  const cur = { ...goal };
  let stageOpacity = 1;

  if (window.ScrollTrigger) {
    $$('[data-chapter]').forEach((sec) => {
      ScrollTrigger.create({
        trigger: sec, start: 'top 60%', end: 'bottom 40%',
        onToggle: (self) => {
          if (!self.isActive) return;
          currentChapter = sec.dataset.chapter;
          Object.assign(goal, actFor(currentChapter));
        },
      });
    });
  }

  /* ── pointer torque + drag ────────────────────────────────────── */
  const pointer = { x: 0, y: 0 };      // normalised −1…1
  const torque  = { x: 0, y: 0 };      // eased
  const spin    = { y: 0, x: 0 };      // user drag offset
  const spinVel = { y: 0, x: 0 };

  addEventListener('pointermove', (e) => {
    pointer.x = (e.clientX / innerWidth) * 2 - 1;
    pointer.y = (e.clientY / innerHeight) * 2 - 1;
  }, { passive: true });

  /* #stage is pointer-events:none, so the drag surface is the framed
     vitrine in the try-on section — the same element the cursor
     badges as "Drag 3D". */
  const frame = $('#stageFrame');
  if (frame) {
    let dragging = false, lastX = 0, lastY = 0;
    frame.addEventListener('pointerdown', (e) => {
      dragging = true;
      lastX = e.clientX; lastY = e.clientY;
      frame.setPointerCapture?.(e.pointerId);
    });
    frame.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      spinVel.y += (e.clientX - lastX) * 0.00055;
      spinVel.x += (e.clientY - lastY) * 0.00040;
      lastX = e.clientX; lastY = e.clientY;
    });
    const stop = (e) => {
      dragging = false;
      frame.releasePointerCapture?.(e.pointerId);
    };
    frame.addEventListener('pointerup', stop);
    frame.addEventListener('pointercancel', stop);
    frame.addEventListener('pointerleave', stop);
  }

  /* ── resize ───────────────────────────────────────────────────── */
  let resizeRaf = 0;
  addEventListener('resize', () => {
    cancelAnimationFrame(resizeRaf);
    resizeRaf = requestAnimationFrame(() => {
      camera.aspect = innerWidth / innerHeight;
      camera.updateProjectionMatrix();
      renderer.setPixelRatio(Math.min(devicePixelRatio, lowPower ? 1.4 : 1.75));
      renderer.setSize(innerWidth, innerHeight);
      Object.assign(goal, actFor(currentChapter));
    });
  });

  /* ── frame loop ───────────────────────────────────────────────── */
  let clock = 0;

  onFrame((dt) => {
    if (document.hidden) return;
    clock += REDUCED ? 0 : dt;
    clothUniforms.uTime.value = clock;

    // ease the framing toward the active chapter
    cur.x = damp(cur.x, goal.x, 2.4, dt);
    cur.y = damp(cur.y, goal.y, 2.4, dt);
    cur.z = damp(cur.z, goal.z, 2.4, dt);
    cur.s = damp(cur.s, goal.s, 2.4, dt);
    cur.rx = damp(cur.rx, goal.rx, 2.0, dt);
    cur.ry = damp(cur.ry, goal.ry, 2.0, dt);
    cur.rz = damp(cur.rz, goal.rz, 2.0, dt);

    // pointer torque — the group leans toward the cursor
    torque.x = damp(torque.x, pointer.y * 0.16, 3.2, dt);
    torque.y = damp(torque.y, pointer.x * 0.28, 3.2, dt);

    // drag spin decays like a turntable rather than stopping dead
    spin.y += spinVel.y;
    spin.x = clamp(spin.x + spinVel.x, -0.55, 0.55);
    spinVel.y *= Math.pow(0.94, dt * 60);
    spinVel.x *= Math.pow(0.94, dt * 60);

    atelier.position.set(cur.x, cur.y, cur.z);
    atelier.scale.setScalar(cur.s);
    atelier.rotation.set(
      cur.rx + torque.x + spin.x,
      cur.ry + torque.y + spin.y,
      cur.rz
    );

    // idle float — the whole group breathes, objects drift on their own
    if (!REDUCED) {
      const t = clock;
      atelier.position.y += Math.sin(t * 0.55) * 0.075;
      hanger.rotation.z = 0.16 + Math.sin(t * 0.7) * 0.07;
      hanger.position.y = 1.55 + Math.sin(t * 0.62 + 1.1) * 0.12;
      pear.rotation.y = t * 0.22;
      pear.position.y = -0.35 + Math.sin(t * 0.85) * 0.08;
      // the contact shadow tightens as the pear settles and softens as
      // it lifts — a shadow that just follows the object reads as a decal
      shadow.position.y = -1.06 + Math.sin(t * 0.85) * 0.015;
      shadow.material.opacity = 0.62 - Math.sin(t * 0.85) * 0.12;
      shadow.scale.setScalar(1 - Math.sin(t * 0.85) * 0.06);
      swatchMeshes.forEach(({ mesh }, i) => {
        mesh.rotation.z += (i % 2 ? -1 : 1) * dt * 0.06;
        mesh.position.y += Math.sin(t * (0.4 + i * 0.13) + i) * 0.004;
      });
    }

    /* Fade the canvas, never #stage: the host owns the one-time
       reveal transition from the stylesheet, and an inline opacity
       here would silently win and cancel it. */
    stageOpacity = damp(stageOpacity, goal.o, 2.2, dt);
    renderer.domElement.style.opacity = stageOpacity.toFixed(3);

    renderer.render(scene, camera);
  });

  /* Free the PMREM render target — the environment texture it produced
     is independent of the generator once it exists. */
  pmrem.dispose();

  setColourway('linen');
  return true;
}

/* ═══════════════════════════ LAUNCH ══════════════════════════════ */
boot();
