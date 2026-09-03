/* ============================================================================
   Track envelopes — clicking (or Enter/Space, native to the <button>) breaks
   the wax seal, folds the flap back and lets the letter rise out. The motion
   itself lives in CSS (.track.is-open); this only flips that class and keeps
   ARIA and the screen-reader label in sync. Independent of the scroll engine
   in prayas.js, so it gets its own small file rather than living inside it.
   ========================================================================= */

(function () {
  "use strict";

  var envelopes = document.querySelectorAll(".track__env");

  envelopes.forEach(function (btn) {
    var track = btn.closest(".track");
    var numeral = track ? track.querySelector(".track__n") : null;
    var label = btn.querySelector(".sr-only");
    var cta = btn.querySelector(".track__cta");
    var name = numeral ? "track " + numeral.textContent.trim() : "this track";

    function setOpen(open) {
      if (track) track.classList.toggle("is-open", open);
      btn.setAttribute("aria-expanded", open ? "true" : "false");
      if (label) label.textContent = (open ? "Reseal " : "Break the seal on ") + name;
      if (cta) cta.textContent = open ? "Reseal" : "Break the seal";
    }

    setOpen(false);
    btn.addEventListener("click", function () {
      setOpen(btn.getAttribute("aria-expanded") !== "true");
    });
  });
})();
