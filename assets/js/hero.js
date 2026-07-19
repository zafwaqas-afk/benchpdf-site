/* BenchPDF — overlay menu + hero parallax.
   Every motion path here is gated on prefers-reduced-motion. */
(function () {
  "use strict";

  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------- full-screen overlay menu ---------- */
  var openBtn = document.getElementById("menu-open");
  var closeBtn = document.getElementById("menu-close");
  var overlay = document.getElementById("overlay");

  if (openBtn && overlay) {
    var lastFocus = null;

    function focusables() {
      return overlay.querySelectorAll("a[href], button:not([disabled])");
    }

    function openMenu() {
      lastFocus = document.activeElement;
      overlay.classList.add("is-open");
      overlay.setAttribute("aria-hidden", "false");
      openBtn.setAttribute("aria-expanded", "true");
      document.body.style.overflow = "hidden";
      var f = focusables();
      if (f.length) f[0].focus();
    }

    function closeMenu() {
      overlay.classList.remove("is-open");
      overlay.setAttribute("aria-hidden", "true");
      openBtn.setAttribute("aria-expanded", "false");
      document.body.style.overflow = "";
      if (lastFocus) lastFocus.focus();
    }

    openBtn.addEventListener("click", openMenu);
    if (closeBtn) closeBtn.addEventListener("click", closeMenu);

    document.addEventListener("keydown", function (e) {
      if (!overlay.classList.contains("is-open")) return;
      if (e.key === "Escape") {
        closeMenu();
        return;
      }
      if (e.key === "Tab") {
        var f = focusables();
        if (!f.length) return;
        var first = f[0];
        var last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    });
  }

  /* ---------- slow hero parallax ---------- */
  var media = document.querySelector(".hero-media, .hero .scene");
  if (media && !reduced) {
    var ticking = false;
    var hero = document.querySelector(".hero");

    function update() {
      ticking = false;
      var y = window.scrollY || window.pageYOffset;
      if (y > hero.offsetHeight) return;
      media.style.transform = "translate3d(0," + (y * 0.22).toFixed(2) + "px,0)";
    }

    window.addEventListener(
      "scroll",
      function () {
        if (!ticking) {
          window.requestAnimationFrame(update);
          ticking = true;
        }
      },
      { passive: true }
    );
  }
})();
