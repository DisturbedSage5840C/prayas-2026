/* ============================================================================
   Prayas '26 — scroll engine

   One requestAnimationFrame loop owns all scroll-driven motion. It writes a
   handful of CSS custom properties on <html> and lets CSS do the compositing;
   nothing here touches an element's style directly except the video.

   Three separate knobs make the scroll slow and fluid:

     1. LENGTH     — how many viewport heights of scrolling one act runs for,
                     plus a shorter hold at the end where progress has already
                     reached 1 and everything is simply settling.
     2. SMOOTHING  — a frame-rate-independent exponential follow. A fixed
                     per-frame lerp runs twice as fast on a 120Hz display as on
                     a 60Hz one; this is time-based, so the feel is identical.
     3. EASING     — every beat is smoothstepped, so things ease in and out
                     rather than starting and stopping abruptly.
   ========================================================================= */

(function () {
  "use strict";

  var root = document.documentElement;
  root.classList.add("js");

  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  var CONFIG = {
    // Seconds for the smoothed scroll to close ~63% of the gap to the real
    // scroll position. The wireframe used a fixed 0.085-per-frame lerp, which
    // is this same feel at 60Hz — but time-based, so a 120Hz display does not
    // run it twice as fast.
    tau: 0.1875,

    // ---- act length ------------------------------------------------------
    // Both in viewport heights, straight off the wireframe.
    //
    //   actVh   the scroll distance progress is measured over: p goes 0 → 1
    //           across (actVh - 100)vh of scrolling.
    //   holdVh  extra pinned distance AFTER p hits 1. Kept at ZERO on purpose.
    //           Any hold here is dead scroll by definition: progress is
    //           already 1, so the video is parked on its last frame, the
    //           closing line is at full opacity and the burst has finished —
    //           the viewport simply stops responding until the pin releases.
    //           At 66 that was ~594px of nothing, which read as the scroll
    //           snagging. The closing beat now runs right up to the release,
    //           so she settles and the page keeps moving in one motion.
    //
    // This replaced a seconds x px/second sizing that worked out to ~20,000px
    // of track — near five times the wireframe's, which is what made every
    // beat feel like it took forever to arrive and forever to leave.
    // Progress is measured over (actVh - 100)vh, so this is not the round
    // number it looks like. The original pace was 460 => 3.6vh of run; this
    // is 3x that, so 3 x 3.6 = 10.8vh of run => actVh 1180. Change this one
    // value and nothing else: every beat below is normalised, so the dance
    // and both cards keep their exact proportions.
    actVh: 1180,
    holdVh: 0,

    // Degrees the backdrop turns across the whole act.
    rotation: 54,

    // ---- the buta field --------------------------------------------------
    // Measured off the reference at a 1470px-wide viewport: emblems sit on a
    // POLAR lattice centred on the dancer — rings ~108px apart, ~150px of arc
    // between neighbours, alternate rings offset half a step so the rings
    // never line up into spokes.
    weave: {
      ringGap: 118,     // px between concentric rings
      arcGap:  164,     // px between neighbours along a ring
      innerR:  128,     // first ring; inside this the dancer covers everything
      size:    23,      // emblem width in px
      tilt:    0.38,    // how far each emblem turns toward its own radius,
                        // 0 = all upright, 1 = fully radial. The reference
                        // reads as a lean, not a rotation.
      centreY: 0.46     // the field's centre, as a fraction of viewport height
    },

    // All beats are in normalised act progress, 0 → 1.
    //
    // The cards TAKE TURNS. Card one holds the stage alone from 30% to 40%
    // and is gone by 50%; card two waits until 56%, holds 66% to 78%, and is
    // gone by 86%. The pause between them is the point — the dancer gets the
    // stage back before the next card claims it.
    //
    // Everything after card two is deliberately tight: the burst and the
    // closing line overlap, p reaches 1 almost immediately after, and the
    // 22vh hold hands straight over to the hackathon.
    //
    // The dancer herself has no beat at all. She is on screen from the first
    // frame — her entrance is a one-shot CSS animation on load, not something
    // scroll drives — and she never leaves; when the act ends the pin releases
    // and scrolling carries her off naturally.
    beats: {
      heroOut:  [0.05, 0.18],   // dims to 10%, never fully leaves
      // The travel here is deliberately small (10px). The stage clips its
      // overflow so the cards can slide in from off-stage, and on a short
      // viewport a longer rise took the eyebrow line straight off the top.
      // The dim to 10% is what carries this beat; the lift is only a nudge.
      heroY:    [0.05, 0.30],
      cueOut:   [0.02, 0.10],

      cardOneIn:  [0.20, 0.30],
      cardOneOut: [0.40, 0.50],
      cardTwoIn:  [0.56, 0.66],
      cardTwoOut: [0.78, 0.86],

      burstIn:  [0.84, 0.93],
      burstOut: [0.97, 1.00],

      // Runs almost to the release. Landing it early left the last stretch
      // with nothing left to change.
      lockIn:   [0.88, 0.97]
    }
  };

  /* -- maths ---------------------------------------------------------------- */

  function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

  /** Smoothstep between two progress marks — eases in and out, never linear. */
  function seg(range, p) {
    var t = clamp01((p - range[0]) / (range[1] - range[0]));
    return t * t * (3 - 2 * t);
  }

  function n(v) { return Math.round(v * 1000) / 1000; }

  /* -- elements -------------------------------------------------------------- */

  var act = document.getElementById("act-one");
  var video = document.getElementById("dancer");
  if (!act) return;

  /* ==========================================================================
     Dancer plate

     The plate is scrubbed against scroll, never played. Three things have to
     be true for that to work, and each has its own failure mode:

       · metadata must be loaded    — preload="auto" often has it ready before
                                      this script runs, so checking readyState
                                      up front matters as much as listening
       · the element must be primed — iOS and Safari refuse to seek a <video>
                                      that has never been kicked, and the kick
                                      has to ride on a user gesture
       · one seek at a time         — writing currentTime every frame queues
                                      seeks faster than the decoder retires
                                      them, which is exactly what leaves the
                                      plate frozen. Wait for `seeked` first.

     If scrubbing still cannot work — a host that ignores Range requests, a
     stalled load, a codec the browser decodes but will not seek — fall back to
     looped playback. She then moves out of step with the scroll, which is far
     better than not moving at all.

     The fallback comes in two flavours, and the distinction matters:

       · FATAL      the element told us it cannot do this — a load error, or
                    seeks that are issued and never report back. Scrubbing is
                    off for good.
       · PROVISIONAL  metadata is simply taking its time. Loop so she is not
                    frozen on the poster, but hand scrubbing back the moment
                    the duration shows up.

     Treating slowness as fatal is what left her standing still: a plain
     five-second timer fired while the clip was still downloading, and because
     the fallback also cleared videoReady, armVideo() bailed out on every
     later event. One slow first load and the scrub never came back.
     ====================================================================== */

  var videoReady = false;
  var videoDuration = 0;
  var seeking = false;
  var seekIssuedAt = 0;
  var loopFallback = false;
  var scrubbingIsDead = false;         // set only by a FATAL fallback

  function startLoopFallback(why, fatal) {
    if (!video || scrubbingIsDead) return;
    if (fatal) scrubbingIsDead = true;
    if (loopFallback) return;

    loopFallback = true;
    videoReady = false;
    video.loop = true;
    var pr = video.play();
    if (pr && typeof pr.catch === "function") pr.catch(function () {});
    if (window.console && console.info) {
      console.info("[prayas] dancer: looping instead of scrubbing (" + why +
                   (fatal ? "" : " — will resume scrubbing if it recovers") + ")");
    }
  }

  function endLoopFallback() {
    loopFallback = false;
    video.loop = false;
    try { video.pause(); } catch (e) {}
  }

  function armVideo() {
    if (scrubbingIsDead) return;

    var d = video.duration || 0;
    if (!isFinite(d) || d <= 0) return;

    videoDuration = d;
    // Metadata arrived after a provisional fallback: take scrubbing back.
    if (loopFallback) endLoopFallback();
    videoReady = true;
    lastWritten = null;                // force one render now that we can seek
  }

  function primeVideo() {
    var pr = video.play();
    if (pr && typeof pr.then === "function") {
      pr.then(function () { if (!loopFallback) video.pause(); }).catch(function () {});
    } else {
      try { video.pause(); } catch (e) {}
    }
  }

  if (video) {
    if (video.readyState >= 1 && video.duration) armVideo();
    video.addEventListener("loadedmetadata", armVideo);
    video.addEventListener("durationchange", armVideo);
    video.addEventListener("canplay", armVideo);
    video.addEventListener("seeked", function () { seeking = false; });
    video.addEventListener("error", function () { startLoopFallback("load error", true); });

    primeVideo();
    ["pointerdown", "touchstart", "wheel", "keydown"].forEach(function (ev) {
      window.addEventListener(ev, primeVideo, { once: true, passive: true });
    });

    /* Metadata that has NOT ARRIVED YET is not metadata that will never
       arrive. Poll instead of setting one blind timer: give up early only if
       the element has actually stopped fetching, and otherwise let a slow
       connection have a full half-minute. Either way the fallback stays
       provisional, so armVideo() can hand scrubbing straight back. */
    var waited = 0;
    var metaWatch = setInterval(function () {
      if (videoReady || scrubbingIsDead) { clearInterval(metaWatch); return; }

      waited += 1;
      var stillFetching = video.networkState === 2;   // NETWORK_LOADING

      if (!stillFetching && waited >= 6) {
        clearInterval(metaWatch);
        startLoopFallback("load stalled with no metadata", false);
      } else if (waited >= 30) {
        clearInterval(metaWatch);
        startLoopFallback("metadata still not in after 30s", false);
      }
    }, 1000);
  }

  /* -- state ---------------------------------------------------------------- */

  var smoothed = window.scrollY || 0;
  var lastTime = 0;
  var lastWritten = null;

  /* ==========================================================================
     The buta field

     A polar lattice cannot come out of a repeating background image — the
     rings have to be laid out — so it is built once here and rebuilt on
     resize. Nothing in the scroll loop touches it; the whole field is turned
     by a single CSS rotate on the parent.
     ====================================================================== */

  var weave = document.getElementById("weave");

  /* Deterministic hash noise. Every emblem gets the same jitter on every
     load and on every resize, so the field never reshuffles under the user. */
  function noise(i, k) {
    var v = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453;
    return v - Math.floor(v);
  }

  function buildWeave() {
    if (!weave) return;

    var W = CONFIG.weave;
    var vw = window.innerWidth;
    var vh = window.innerHeight;
    var cx = vw / 2;
    var cy = vh * W.centreY;

    root.style.setProperty("--stage-x", "50%");
    root.style.setProperty("--stage-y", W.centreY * 100 + "%");

    // Far enough to cover the corner the centre is furthest from, plus the
    // slack the parent's rotation needs so no corner ever swings empty.
    var reach = Math.hypot(Math.max(cx, vw - cx), Math.max(cy, vh - cy)) + W.size;

    var html = "";
    var ring = 0;

    for (var r = W.innerR; r < reach; r += W.ringGap, ring++) {
      var count = Math.max(4, Math.round(2 * Math.PI * r / W.arcGap));
      var step = 360 / count;
      var offset = (ring % 2) * step / 2;      // half-step stagger, ring to ring

      for (var i = 0; i < count; i++) {
        var seed = ring * 97 + i;
        var deg = offset + i * step + (noise(seed, 1) - 0.5) * step * 0.34;
        var rad = deg * Math.PI / 180;
        var rr = r + (noise(seed, 2) - 0.5) * W.ringGap * 0.3;

        var x = cx + Math.cos(rad) * rr;
        var y = cy + Math.sin(rad) * rr;
        if (x < -W.size || x > vw + W.size || y < -W.size || y > vh + W.size) continue;

        // Lean toward the radius. deg is measured from due east, so a fully
        // radial emblem is rotated (deg + 90). Wrap that to the SHORTEST
        // signed turn before damping it — without the wrap, an emblem at
        // due-left works out to +102 deg where its mirror on the right gets
        // +34, and the field leans lopsided.
        var radial = (deg + 90 + 180) % 360;
        if (radial < 0) radial += 360;
        radial -= 180;
        var tilt = radial * W.tilt + (noise(seed, 3) - 0.5) * 10;
        var size = W.size * (0.82 + noise(seed, 4) * 0.42);

        html += '<i class="buta" style="' +
          "--x:" + Math.round(x) + "px;" +
          "--y:" + Math.round(y) + "px;" +
          "--w:" + Math.round(size) + "px;" +
          "--a:" + Math.round(tilt) + "deg;" +
          "--buta-o:" + (0.16 + noise(seed, 5) * 0.16).toFixed(2) +
          '"></i>';
      }
    }

    weave.innerHTML = html;
  }

  /** Size the act: the progress run plus the end hold, both in viewport
      heights. The stage stays pinned for (actVh + holdVh - 100)vh. */
  function sizeAct() {
    act.style.height = (CONFIG.actVh + CONFIG.holdVh) / 100 * window.innerHeight + "px";
  }

  /** The distance p is measured over — deliberately SHORTER than the pin, so
      p saturates at 1 with CONFIG.holdVh still left to scroll. That tail is
      the settle: everything has landed and nothing is still moving. */
  function progressSpan() {
    return Math.max(1, CONFIG.actVh / 100 * window.innerHeight - window.innerHeight);
  }

  function write(name, value) { root.style.setProperty(name, value); }

  /** The furthest point the browser says it can seek to, or 0 for none. */
  function seekableEnd() {
    var s = video.seekable;
    return s && s.length ? s.end(s.length - 1) : 0;
  }

  function scrubTo(p) {
    if (!videoReady || loopFallback) return;

    /* A host that does not serve byte ranges looks like THIS from in here:
       the whole file is buffered, duration is known, readyState is 4 — and
       `seekable` is still empty, so every assignment to currentTime silently
       snaps back to 0 and she sits frozen on the first frame.

       Nothing above catches it: no error fires, and no seek is ever issued,
       so the "seeks are not being honoured" timeout below never even arms.
       Judge it only once the data is all in, because `seekable` is legitimately
       empty while a file is still arriving. */
    if (video.readyState >= 4 && seekableEnd() <= 0) {
      startLoopFallback("the response is not byte-range seekable", true);
      return;
    }

    // Linear across the whole act, exactly as the wireframe scrubbed it. The
    // previous smoothstep over a 0.02–0.88 slice made her rush the middle of
    // the dance and then stall for the last eighth of the scroll.
    var target = p * Math.max(0, videoDuration - 0.04);

    if (!seeking && Math.abs(video.currentTime - target) > 1 / 60) {
      seeking = true;
      seekIssuedAt = performance.now();
      try { video.currentTime = target; } catch (e) { seeking = false; }
    }

    // A seek that was issued and never reported back means the host is not
    // serving byte ranges. That one IS fatal — no amount of waiting fixes it.
    if (seeking && performance.now() - seekIssuedAt > 3000) {
      startLoopFallback("seeks are not being honoured", true);
    }
  }

  function render(p) {
    var b = CONFIG.beats;

    var heroOut = seg(b.heroOut, p);

    // Each card is (arrival) x (1 - departure). Both terms feed the offset as
    // well as the opacity, so a card slides back out the same side it came in
    // rather than just dissolving in place.
    var e1 = seg(b.cardOneIn, p) * (1 - seg(b.cardOneOut, p));
    var e2 = seg(b.cardTwoIn, p) * (1 - seg(b.cardTwoOut, p));

    // The stage is empty from 80% on; the rays open up to fill it.
    var burst = seg(b.burstIn, p) * (1 - seg(b.burstOut, p) * 0.5);
    var lock  = seg(b.lockIn, p);

    write("--p", n(p));
    write("--rot", n(p * CONFIG.rotation) + "deg");

    // The logo dims as the scene fills up, but never leaves — it stays put,
    // just quieter, so the top of the stage doesn't read as empty once the
    // dancer and cards take over.
    write("--hero-o", n(1 - heroOut * 0.9));
    write("--hero-y", n(-seg(b.heroY, p) * 10) + "px");

    // The petal ring breathes outward and brightens on the burst. Its own
    // fade-up is a load animation, so --ring-o drives stroke-opacity rather
    // than opacity — otherwise the animation would clobber it.
    write("--ring-o", n(0.88 + 0.12 * burst));
    write("--ring-s", n(1 + 0.09 * burst));

    // Cards slide in from their own side of the stage, hold, then slide back.
    write("--e1-o", n(e1));
    write("--e1-x", n(-46 * (1 - e1)) + "px");
    write("--e2-o", n(e2));
    write("--e2-x", n(46 * (1 - e2)) + "px");

    write("--cue-o", n(1 - seg(b.cueOut, p)));

    // The closing line needs the bottom of the stage to itself. Only --lock-o
    // is written: CSS derives the dancer's lift from it, so a short landscape
    // viewport can ask for a bigger lift without the engine knowing about it.
    write("--lock-o", n(lock));

    // Flat black at rest, like the reference. The glow exists for the burst.
    write("--glow-o", n(burst));
  }

  function frame(now) {
    var dt = lastTime ? Math.min((now - lastTime) / 1000, 0.1) : 1 / 60;
    lastTime = now;

    var target = window.scrollY || window.pageYOffset || 0;

    // Frame-rate-independent exponential smoothing: the fraction of the
    // remaining gap closed this frame depends on elapsed time, not on how many
    // frames the display happens to deliver.
    smoothed += (target - smoothed) * (1 - Math.exp(-dt / CONFIG.tau));
    if (Math.abs(target - smoothed) < 0.15) smoothed = target;

    var p = clamp01((smoothed - act.offsetTop) / progressSpan());

    if (lastWritten === null || Math.abs(p - lastWritten) > 0.0002) {
      render(p);
      lastWritten = p;
    }
    scrubTo(p);

    requestAnimationFrame(frame);
  }

  /* -- reduced motion -------------------------------------------------------
     CSS already unpins the stage and reveals everything; park the plate on a
     representative frame and stay out of the way. */
  function startStatic() {
    if (!video) return;
    var park = function () {
      try { video.currentTime = (video.duration || 0) * 0.4; } catch (e) {}
    };
    if (video.readyState >= 1) park();
    video.addEventListener("loadedmetadata", park, { once: true });
  }

  /* ==========================================================================
     Hackathon pointer glow

     Writes the pointer position, in px relative to the section, into two CSS
     custom properties. CSS does the rest — see .hack__glow. Coalesced onto
     one rAF so a 1000Hz mouse cannot force more than one write per frame.
     ====================================================================== */

  function wirePointerGlow() {
    var hack = document.getElementById("hackathon");
    if (!hack || reduceMotion.matches) return;
    if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;

    var px = 0, py = 0, queued = false;

    function flush() {
      queued = false;
      hack.style.setProperty("--mx", px + "px");
      hack.style.setProperty("--my", py + "px");
    }

    hack.addEventListener("pointermove", function (e) {
      var box = hack.getBoundingClientRect();
      px = Math.round(e.clientX - box.left);
      py = Math.round(e.clientY - box.top);
      if (!queued) { queued = true; requestAnimationFrame(flush); }
    }, { passive: true });
  }

  var resizeTimer = 0;
  function onResize() {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      buildWeave();
      if (reduceMotion.matches) return;   // CSS owns the layout in that mode
      sizeAct();
      lastWritten = null;
    }, 120);
  }

  function start() {
    // The field is decoration, not motion — it is built in every mode, and
    // reduced motion returns before the scroll rig is wired up, so it needs
    // its own resize hookup rather than relying on onResize below.
    buildWeave();
    wirePointerGlow();
    window.addEventListener("resize", onResize, { passive: true });

    if (reduceMotion.matches) { startStatic(); return; }
    sizeAct();
    smoothed = window.scrollY || 0;
    render(clamp01((smoothed - act.offsetTop) / progressSpan()));
    requestAnimationFrame(frame);
  }

  start();

  if (typeof reduceMotion.addEventListener === "function") {
    reduceMotion.addEventListener("change", function () { location.reload(); });
  }
})();
