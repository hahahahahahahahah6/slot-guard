/* slot-guard options page — task CRUD, templates, selector tester. */
(function () {
  "use strict";

  var TEMPLATES = {
    visa: {
      name: "US visa appointment calendar",
      urlPattern: "https://*.usvisascheduling.com/*",
      openUrl: "",
      selector: ".ui-datepicker-calendar td[data-handler='selectDay']:not(.ui-state-disabled)",
      mode: "text-present",
      intervalMin: 30,
    },
    generic: {
      name: "Price / stock watcher",
      urlPattern: "https://*/*",
      openUrl: "",
      selector: ".price, [data-price], .stock-status",
      mode: "text-changed",
      intervalMin: 60,
    },
  };

  function uid() {
    return "t" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }
  function $(id) { return document.getElementById(id); }

  async function getTasks() {
    var d = await chrome.storage.local.get("tasks");
    return d.tasks || [];
  }
  async function saveTasks(tasks) {
    await chrome.storage.local.set({ tasks: tasks });
    await chrome.runtime.sendMessage({ type: "SG_RESCHEDULE" });
  }

  function readForm() {
    return {
      id: $("f_id").value || uid(),
      name: $("f_name").value.trim(),
      urlPattern: $("f_urlPattern").value.trim(),
      openUrl: $("f_openUrl").value.trim(),
      selector: $("f_selector").value.trim(),
      mode: $("f_mode").value,
      intervalMin: Math.max(1, Math.min(1440, Number($("f_intervalMin").value) || 30)),
      enabled: true,
    };
  }
  function fillForm(t) {
    $("f_id").value = t.id || "";
    $("f_name").value = t.name || "";
    $("f_urlPattern").value = t.urlPattern || "";
    $("f_openUrl").value = t.openUrl || "";
    $("f_selector").value = t.selector || "";
    $("f_mode").value = t.mode || "text-changed";
    $("f_intervalMin").value = t.intervalMin || 30;
    $("formTitle").textContent = t.id ? "Edit task" : "New task";
    window.scrollTo(0, document.getElementById("formTitle").offsetTop);
  }
  function clearForm() {
    fillForm({ id: "", name: "", urlPattern: "", openUrl: "", selector: "", mode: "text-changed", intervalMin: 30 });
    $("formError").textContent = "";
    $("testResult").innerHTML = "";
  }

  function validate(t) {
    var errs = [];
    if (!t.name) errs.push("name is required");
    if (!t.urlPattern) errs.push("urlPattern is required");
    if (!t.selector) errs.push("selector is required");
    return errs;
  }

  async function ensureHostPermission(urlPattern) {
    // Ask for optional host access so scripting can run on the watched site.
    try {
      var origin = urlPattern.replace(/\/\*?$/, "/*");
      var granted = await chrome.permissions.request({ origins: [origin] });
      return granted;
    } catch (e) {
      return false;
    }
  }

  async function renderList() {
    var tasks = await getTasks();
    var box = $("taskList");
    if (!tasks.length) {
      box.innerHTML = '<p class="hint">No tasks yet. Use a template above or create one.</p>';
      return;
    }
    box.innerHTML = "";
    tasks.forEach(function (t) {
      var div = document.createElement("div");
      div.className = "card";
      var st = t.enabled ? (t.status || "NEW") : "OFF";
      var last = t.lastCheck ? new Date(t.lastCheck).toLocaleString() : "never";
      div.innerHTML =
        '<div><span class="name"></span>' +
        '<span class="badge st-' + st + '">' + st + "</span></div>" +
        '<div class="meta"></div>' +
        (t.statusDetail ? '<div class="meta"></div>' : "") +
        '<div style="margin-top:8px">' +
        '<button data-act="run">Check now</button>' +
        '<button data-act="toggle">' + (t.enabled ? "Pause" : "Resume") + "</button>" +
        '<button data-act="edit">Edit</button>' +
        '<button data-act="del" class="danger">Delete</button></div>';
      div.querySelector(".name").textContent = t.name;
      var metas = div.querySelectorAll(".meta");
      metas[0].textContent = t.mode + " · every " + t.intervalMin + " min · " + t.selector + " · last check " + last;
      if (t.statusDetail) metas[1].textContent = t.statusDetail;
      div.querySelectorAll("button").forEach(function (b) {
        b.addEventListener("click", function () { onAction(t.id, b.dataset.act); });
      });
      box.appendChild(div);
    });
  }

  async function onAction(id, act) {
    var tasks = await getTasks();
    var t = tasks.find(function (x) { return x.id === id; });
    if (!t) return;
    if (act === "run") {
      var r = await chrome.runtime.sendMessage({ type: "SG_RUN_NOW", id: id });
      renderList();
      if (r && r.paused) alert("Paused: bot check detected. Solve it in the tab.");
      else if (r && r.error) alert("Check failed: " + (r.error || r.reason || ""));
      else if (r && r.ok) alert(r.changed ? "Change detected — notification sent." : "Checked: no change.");
    } else if (act === "toggle") {
      t.enabled = !t.enabled;
      if (!t.enabled) t.status = "OFF";
      else if (t.status === "OFF") t.status = "NEW";
      await saveTasks(tasks);
      renderList();
    } else if (act === "edit") {
      fillForm(t);
    } else if (act === "del") {
      if (confirm('Delete "' + t.name + '"?')) {
        await saveTasks(tasks.filter(function (x) { return x.id !== id; }));
        renderList();
      }
    }
  }

  document.querySelectorAll("[data-tpl]").forEach(function (b) {
    b.addEventListener("click", function () {
      var tpl = TEMPLATES[b.dataset.tpl];
      fillForm(Object.assign({ id: "" }, tpl));
    });
  });

  $("btnTest").addEventListener("click", async function () {
    var sel = $("f_selector").value.trim();
    var box = $("testResult");
    if (!sel) { box.innerHTML = '<span class="fail">Enter a selector first.</span>'; return; }
    box.textContent = "Testing…";
    try {
      var snap = await chrome.runtime.sendMessage({ type: "SG_TEST_SELECTOR", selector: sel });
      if (!snap || snap.ok === false) {
        box.innerHTML = '<span class="fail">Failed: ' + escapeHtml((snap && (snap.detail || snap.error)) || "no response") +
          ". Make sure the target page is the active tab and the extension can access it.</span>";
        return;
      }
      if (snap.challenge) {
        box.innerHTML = '<span class="fail">This page is showing a bot check (' +
          escapeHtml(snap.challengeKind || "challenge") + "). slot-guard will pause here — solve it manually.</span>";
        return;
      }
      var n = snap.matches.length;
      var sample = snap.matches.slice(0, 3).map(function (m) { return m.text; }).join(" | ").slice(0, 120);
      box.innerHTML = '<span class="ok">' + n + " element" + (n === 1 ? "" : "s") + " matched.</span>" +
        (sample ? "<div class='hint'>e.g. " + escapeHtml(sample) + "</div>" : "");
    } catch (e) {
      box.innerHTML = '<span class="fail">Error: ' + escapeHtml(e.message) + "</span>";
    }
  });

  function escapeHtml(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  $("taskForm").addEventListener("submit", async function (e) {
    e.preventDefault();
    var t = readForm();
    var errs = validate(t);
    if (errs.length) { $("formError").textContent = errs.join("; "); return; }
    var okPerm = await ensureHostPermission(t.urlPattern);
    if (!okPerm) {
      $("formError").textContent = "Host permission was not granted — the extension cannot read that site.";
      return;
    }
    var tasks = await getTasks();
    var i = tasks.findIndex(function (x) { return x.id === t.id; });
    if (i >= 0) {
      t.last = tasks[i].last; t.status = tasks[i].status; t.statusDetail = tasks[i].statusDetail;
      t.lastCheck = tasks[i].lastCheck; t.enabled = tasks[i].enabled;
      tasks[i] = t;
    } else {
      t.status = "NEW"; tasks.push(t);
    }
    await saveTasks(tasks);
    clearForm();
    renderList();
  });
  $("btnCancel").addEventListener("click", clearForm);

  renderList();
})();
