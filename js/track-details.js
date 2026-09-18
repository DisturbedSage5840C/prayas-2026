/* ============================================================================
   Track details — a single shared <dialog> whose content is swapped in per
   track. Triggers only exist inside an opened seal (see track-envelope.js),
   so this only needs to read the clicked trigger's data-track-details index
   and look it up here rather than parse anything from the page itself.
   ========================================================================= */

(function () {
  "use strict";

  var TRACKS = {
    "01": {
      name: "Open Innovation",
      questions: [
        "Teams are free to work on any project and problem statement that fits the hackathon theme of “AI for good.”"
      ]
    },
    "02": {
      name: "Urban Planning",
      questions: [
        "How can real-time data and AI make it simpler for people and goods to move through a city without the usual friction and without causing delays?",
        "How can technology make urban spaces safer and more accessible to people of all backgrounds and abilities?",
        "How can digital twins and simulations let us try out changes to a city virtually, so we get it right before touching the real thing?"
      ]
    },
    "03": {
      name: "Future Finance",
      questions: [
        "Can blockchain make cross-border payments faster and cheaper?",
        "How can future technologies make credit accessible without traditional credit scores?",
        "How can we build financial systems that work reliably even with limited internet access?"
      ]
    },
    "04": {
      name: "Medical Diagnostics",
      questions: [
        "How can a structured AI-based system improve the accuracy of self-assessment and diagnosis?",
        "How can smartphone-based tools and wearable devices help collect health information and detect potential health issues outside hospitals and clinics?",
        "How can we integrate multiple kinds of diagnostic evidence (medical imaging, blood tests, symptoms, etc.) into a single medical evaluation?"
      ]
    }
  };

  var dlg = document.getElementById("trackDetails");
  if (!dlg) return;

  var openers = document.querySelectorAll("[data-track-details]");
  if (!openers.length) return;

  var title = dlg.querySelector(".trackdetails__title");
  var list = dlg.querySelector(".trackdetails__questions");
  var lastFocus = null;
  var supportsModal = typeof dlg.showModal === "function";

  function fill(track) {
    title.textContent = track.name;
    list.innerHTML = "";
    track.questions.forEach(function (q) {
      var li = document.createElement("li");
      li.textContent = q;
      list.appendChild(li);
    });
  }

  function open(track) {
    fill(track);
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
    var track = TRACKS[btn.getAttribute("data-track-details")];
    if (!track) return;
    btn.addEventListener("click", function () {
      open(track);
    });
  });

  dlg.querySelectorAll("[data-trackdetails-close]").forEach(function (btn) {
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
