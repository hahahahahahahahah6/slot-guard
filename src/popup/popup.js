(function () {
  "use strict";
  async function render() {
    var d = await chrome.storage.local.get("tasks");
    var tasks = d.tasks || [];
    var box = document.getElementById("list");
    if (!tasks.length) {
      box.innerHTML = '<p class="d">No watch tasks yet.</p>';
      return;
    }
    box.innerHTML = "";
    tasks.forEach(function (t) {
      var st = t.enabled ? (t.status || "NEW") : "OFF";
      var div = document.createElement("div");
      div.className = "t";
      div.innerHTML = '<span class="n"></span><span class="b st-' + st + '">' + st + "</span>" +
        '<div class="d"></div>';
      div.querySelector(".n").textContent = t.name;
      div.querySelector(".d").textContent =
        (t.enabled ? "every " + t.intervalMin + " min" : "paused") +
        (t.statusDetail ? " · " + t.statusDetail : "");
      box.appendChild(div);
    });
  }
  document.getElementById("openOptions").addEventListener("click", function (e) {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });
  render();
})();
