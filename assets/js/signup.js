(function () {
  "use strict";
  var form = document.getElementById("signup-form");
  if (!form) return;

  var started = Date.now();
  var progress = document.getElementById("sf-progress");
  var steps = Array.prototype.slice.call(form.querySelectorAll(".sf-step"));
  var EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

  function show(n) {
    steps.forEach(function (s) {
      var on = s.getAttribute("data-step") === String(n);
      s.classList.toggle("is-on", on);
    });
    if (progress) progress.textContent = "0" + n + " / 03";
    var first = form.querySelector('.sf-step[data-step="' + n + '"] input, .sf-step[data-step="' + n + '"] select, .sf-step[data-step="' + n + '"] button');
    if (first) first.focus();
  }

  function error(step, message) {
    var el = document.getElementById("sf-error-" + step);
    if (!el) return;
    if (message) { el.textContent = message; el.hidden = false; }
    else { el.hidden = true; }
  }

  function validStep1() {
    var name = document.getElementById("sf-name").value.trim();
    var email = document.getElementById("sf-email").value.trim();
    if (!name) { error(1, "Add your name."); return false; }
    if (!EMAIL.test(email)) { error(1, "That email address does not look right."); return false; }
    error(1, null);
    return true;
  }

  form.addEventListener("click", function (e) {
    var chip = e.target.closest(".chip");
    if (chip) {
      chip.setAttribute("aria-pressed", chip.getAttribute("aria-pressed") === "true" ? "false" : "true");
      return;
    }
    var next = e.target.closest("[data-next]");
    if (next) {
      var to = next.getAttribute("data-next");
      if (to === "2" && !validStep1()) return;
      show(to);
      return;
    }
    var back = e.target.closest("[data-back]");
    if (back) { show(back.getAttribute("data-back")); return; }
  });

  var skip = document.getElementById("sf-skip");
  if (skip) skip.addEventListener("click", function () {
    form.querySelectorAll('.sf-step[data-step="2"] .chip[aria-pressed="true"]').forEach(function (c) {
      c.setAttribute("aria-pressed", "false");
    });
    document.getElementById("sf-role").value = "";
    document.getElementById("sf-industry").value = "";
    show(3);
  });

  function picked(name) {
    var on = form.querySelectorAll('.chips[data-name="' + name + '"] .chip[aria-pressed="true"]');
    var vals = Array.prototype.map.call(on, function (c) { return c.textContent.trim(); });
    return vals.length ? vals.join(", ") : null;
  }

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    if (!validStep1()) { show(1); return; }
    if (!document.getElementById("sf-consent").checked) {
      error(3, "Sign-up needs the consent box ticked, so it is your choice on record.");
      return;
    }
    error(3, null);
    var submit = document.getElementById("sf-submit");
    submit.setAttribute("aria-disabled", "true");
    submit.textContent = "Signing up";

    fetch("/api/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: document.getElementById("sf-name").value.trim(),
        email: document.getElementById("sf-email").value.trim(),
        role: document.getElementById("sf-role").value || null,
        industry: document.getElementById("sf-industry").value || null,
        converts: picked("converts"),
        tools: picked("tools"),
        breaks: picked("breaks"),
        consent: true,
        company: document.getElementById("sf-company").value,
        elapsed: Date.now() - started
      })
    }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, body: j }; }); })
      .then(function (res) {
        if (res.ok && res.body.ok) {
          form.hidden = true;
          document.querySelector(".tool-hero .lede").hidden = true;
          document.getElementById("sf-success").hidden = false;
          if (progress) progress.textContent = "03 / 03";
        } else {
          error(3, res.body.error || "Something went wrong on our side. Try again in a minute.");
          submit.removeAttribute("aria-disabled");
          submit.textContent = "Sign up";
        }
      })
      .catch(function () {
        error(3, "Could not reach the server. Check your connection and try again.");
        submit.removeAttribute("aria-disabled");
        submit.textContent = "Sign up";
      });
  });
})();
