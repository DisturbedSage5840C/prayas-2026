/* ============================================================================
   Prayas '26 — scroll engine

   One requestAnimationFrame loop owns all scroll-driven motion. It writes a
   handful of CSS custom properties on <html> and lets CSS do the compositing;
   nothing here touches an element's style directly except the video.

   Three things make the scroll feel slower and more fluid than the previous
   build, and they are separate knobs on purpose:

     1. TRACK      — how much scroll distance one act spans. Longer track =
                     less animation per wheel tick = slower. This is the main
                     "speed" control and it lives in CSS (.act { height }),
                     read back here so the two can never drift apart.
     2. SMOOTHING  — a frame-rate-independent exponential follow. The old lerp
                     used a fixed per-frame factor, so it ran visibly faster on
                     120Hz displays than on 60Hz. This one is time-based, so
                     the feel is identical on every refresh rate.
     3. EASING     — every beat is smoothstepped rather than linear, so things
                     ease in and out instead of starting and stopping abruptly.
   ========================================================================= */

(function () {
  "use strict";

  var root = document.documentElement;
  root.classList.add("js");

  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  /* -- tuning ---------------------------------------------------------------
     Beats are expressed in normalised act progress (0 → 1) so retiming the
     whole piece means changing the track height in CSS, not these numbers. */
  var CONFIG = {
    // seconds for the smoothed scroll to cover ~63% of the gap to the real
    // scroll position. Higher = heavier, more glide. 0.16–0.30 reads well.
    tau: 0.20,

    // How long act one should take to play end to end, in seconds of steady
    // scrolling. This is the honest way to express "slower": the track length
    // is derived from it rather than guessed at in vh, so the timing holds on
    // any viewport height. referenceRate is a comfortable sustained scroll
    // speed in CSS px per second — the constant that turns seconds into pixels.
    actSeconds: 25,
    referenceRate: 800,

    // how far the mandala turns across the whole act, in degrees
    rotation: 54,

    beats: {
      heroOut:   [0.13, 0.26],
      cueOut:    [0.03, 0.10],

      dancerIn:  [0.00, 0.12],
      dancerDim: [0.22, 0.34],

      cardOneIn:  [0.22, 0.35],
      cardOneOut: [0.44, 0.55],
      cardTwoIn:  [0.59, 0.71],
      cardTwoOut: [0.80, 0.89],

      lockIn:    [0.90, 0.975],

      // the dance itself plays across this slice of the act
      video:     [0.02, 0.88]
    }
  };

  /* -- maths ---------------------------------------------------------------- */

  function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

  /** Smoothstep between two progress marks — eases in and out, never linear. */
  function seg(range, p) {
    var t = clamp01((p - range[0]) / (range[1] - range[0]));
    return t * t * (3 - 2 * t);
  }

  /** Round for CSS output; keeps the variable strings short and stable. */
  function n(v) { return Math.round(v * 1000) / 1000; }

  /* -- elements -------------------------------------------------------------- */

  var act = document.getElementById("act-one");
  var video = document.getElementById("dancer");
  if (!act) return;

  /* -- video scrubbing -------------------------------------------------------
     The plate is scrubbed, never played, so it has to be seekable before we
     touch currentTime. Some browsers only populate duration after metadata. */
  var videoReady = false;
  var videoDuration = 0;

  if (video) {
    video.addEventListener("loadedmetadata", function () {
      videoDuration = video.duration || 0;
      videoReady = isFinite(videoDuration) && videoDuration > 0;
    });
    // A muted play/pause primes decoding on browsers that will not seek an
    // untouched video. Failure here is harmless — the poster still shows.
    var prime = video.play();
    if (prime && typeof prime.then === "function") {
      prime.then(function () { video.pause(); }).catch(function () {});
    }
  }

  /* -- state ---------------------------------------------------------------- */

  var smoothed = window.scrollY || 0;
  var lastTime = 0;
  var lastWritten = null;

  /** Size the act so playing it through takes CONFIG.actSeconds of scrolling. */
  function sizeAct() {
    var travel = CONFIG.actSeconds * CONFIG.referenceRate;
    act.style.height = (travel + window.innerHeight) + "px";
  }

  function trackLength() {
    // The act's own height minus one viewport is exactly the distance over
    // which the sticky stage is pinned — i.e. the usable progress range.
    return Math.max(1, act.offsetHeight - window.innerHeight);
  }

  function write(name, value) {
    root.style.setProperty(name, value);
  }

  function render(p) {
    var b = CONFIG.beats;

    var heroOut  = seg(b.heroOut, p);
    var dancerIn = seg(b.dancerIn, p);
    var dancerDim = seg(b.dancerDim, p);

    var e1 = seg(b.cardOneIn, p) * (1 - seg(b.cardOneOut, p));
    var e2 = seg(b.cardTwoIn, p) * (1 - seg(b.cardTwoOut, p));
    var lock = seg(b.lockIn, p);

    write("--p", n(p));
    write("--rot", n(p * CONFIG.rotation) + "deg");

    write("--hero-o", n(1 - heroOut));
    write("--hero-y", n(heroOut * -46) + "px");

    write("--dancer-o", n((0.5 + 0.5 * dancerIn) * (1 - dancerDim * 0.6)));
    write("--dancer-y", n((1 - dancerIn) * 34) + "px");
    write("--dancer-s", n(0.92 + dancerIn * 0.08));

    // Cards slide in from their own side of the stage.
    write("--e1-o", n(e1));
    write("--e1-x", n(-54 * (1 - e1)) + "px");
    write("--e2-o", n(e2));
    write("--e2-x", n(54 * (1 - e2)) + "px");

    write("--lock-o", n(lock));
    write("--cue-o", n(1 - seg(b.cueOut, p)));

    // The ground warms slightly as the act progresses.
    write("--glow-o", n(0.35 + 0.4 * Math.max(e1, e2, lock)));

    if (videoReady) {
      var vt = seg(b.video, p) * videoDuration;
      // Guard against redundant seeks; they stall decoding on Safari.
      if (Math.abs(video.currentTime - vt) > 0.02) {
        try { video.currentTime = vt; } catch (e) { /* not seekable yet */ }
      }
    }
  }

  function frame(now) {
    var dt = lastTime ? Math.min((now - lastTime) / 1000, 0.1) : 1 / 60;
    lastTime = now;

    var target = window.scrollY || window.pageYOffset || 0;

    // Frame-rate-independent exponential smoothing: the fraction of the
    // remaining gap closed this frame depends on elapsed time, not on how
    // many frames the display happens to deliver.
    smoothed += (target - smoothed) * (1 - Math.exp(-dt / CONFIG.tau));

    // Snap once we are close enough that further easing is invisible.
    if (Math.abs(target - smoothed) < 0.15) smoothed = target;

    var p = clamp01((smoothed - act.offsetTop) / trackLength());

    if (lastWritten === null || Math.abs(p - lastWritten) > 0.0002) {
      render(p);
      lastWritten = p;
    }

    requestAnimationFrame(frame);
  }

  /* -- reduced motion -------------------------------------------------------
     CSS already unpins the stage and reveals everything. All that is left is
     to park the video on a representative frame and stay out of the way. */
  function startStatic() {
    if (video) {
      video.addEventListener("loadedmetadata", function () {
        try { video.currentTime = (video.duration || 0) * 0.4; } catch (e) {}
      });
    }
  }

  /* Resizing changes the viewport term in the track length, so the act has to
     be re-sized or the timing drifts. Debounced — this triggers layout. */
  var resizeTimer = 0;
  function onResize() {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      sizeAct();
      lastWritten = null;
    }, 120);
  }

  function start() {
    if (reduceMotion.matches) { startStatic(); return; }
    sizeAct();
    window.addEventListener("resize", onResize, { passive: true });
    smoothed = window.scrollY || 0;
    render(clamp01((smoothed - act.offsetTop) / trackLength()));
    requestAnimationFrame(frame);
  }

  start();

  // Re-evaluate if the user flips the OS setting mid-session.
  if (typeof reduceMotion.addEventListener === "function") {
    reduceMotion.addEventListener("change", function () { location.reload(); });
  }
})();
