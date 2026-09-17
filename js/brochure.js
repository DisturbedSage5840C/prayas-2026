/* ============================================================================
   Brochure preview modal

   A small, self-contained toggle for the <dialog> that mirrors the event
   cards' illustrated plate. Uses the platform dialog so focus trapping and
   the Esc key come for free; the only extras are a backdrop click to close
   and locking body scroll while it is open.
   ========================================================================= */

(function () {
  "use strict";

  var dlg = document.getElementById("brochure");
  if (!dlg) return;

  var openers = document.querySelectorAll("[data-brochure-open]");
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

  dlg.querySelectorAll("[data-brochure-close]").forEach(function (btn) {
    btn.addEventListener("click", close);
  });

  // Click on the dialog element itself — i.e. the backdrop, not the card.
  dlg.addEventListener("click", function (e) {
    if (e.target === dlg) close();
  });

  // showModal() already closes on Esc, but wire it for the fallback path.
  dlg.addEventListener("cancel", function () {
    document.documentElement.style.overflow = "";
  });
  if (!supportsModal) {
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && dlg.hasAttribute("open")) close();
    });
  }
})();
