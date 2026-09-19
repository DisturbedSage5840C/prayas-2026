/* ============================================================================
   Rules & guidelines modal

   Same open/close mechanics as brochure.js (platform <dialog>, backdrop
   click, body-scroll lock) — kept as its own tiny file rather than merged
   into that one so each modal stays a self-contained, single-purpose toggle.
   ========================================================================= */

(function () {
  "use strict";

  var dlg = document.getElementById("eventRules");
  if (!dlg) return;

  var openers = document.querySelectorAll("[data-eventrules-open]");
  if (!openers.length) return;

  var lastFocus = null;
  var supportsModal = typeof dlg.showModal === "function";

  function open() {
    lastFocus = document.activeElement;
    if (supportsModal) {
      dlg.showModal();
    } else {
      dlg.setAttribute("open", "");
    }
    document.documentElement.style.overflow = "hidden";
  }

  function close() {
    if (supportsModal && dlg.open) {
      dlg.close();
    } else {
      dlg.removeAttribute("open");
    }
    document.documentElement.style.overflow = "";
    if (lastFocus && typeof lastFocus.focus === "function") lastFocus.focus();
  }

  openers.forEach(function (btn) {
    btn.addEventListener("click", open);
  });

  dlg.querySelectorAll("[data-eventrules-close]").forEach(function (btn) {
    btn.addEventListener("click", close);
  });

  dlg.addEventListener("click", function (e) {
    if (e.target === dlg) close();
  });

  dlg.addEventListener("cancel", function () {
    document.documentElement.style.overflow = "";
  });
  if (!supportsModal) {
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && dlg.hasAttribute("open")) close();
    });
  }
})();
