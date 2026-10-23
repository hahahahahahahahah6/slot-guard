/* slot-guard service worker — the orchestrator.
 * MV3 workers die constantly: ALL state lives in chrome.storage.local,
 * every alarm re-derives what to do from scratch.
 * Safety rule: on any bot-check/challenge signal, the task pauses and the
 * user is asked to solve it manually. We never click through checks.
 */
importScripts("src/lib/detector.js");

var SGW = {};

SGW.store = {
  async get(keys) {
    return chrome.storage.local.get(keys || null);
  },
  async set(obj) {
    return chrome.storage.local.set(obj);
  },
  async getTasks() {
    var d = await chrome.storage.local.get("tasks");
    return d.tasks || [];
  },
  async saveTasks(tasks) {
    await chrome.storage.local.set({ tasks: tasks });
  },
  async getTask(id) {
    var tasks = await SGW.store.getTasks();
    return tasks.find(function (t) { return t.id === id; }) || null;
  },
  async updateTask(id, patch) {
    var tasks = await SGW.store.getTasks();
    var changed = false;
    tasks = tasks.map(function (t) {
      if (t.id === id) { changed = true; return Object.assign({}, t, patch); }
      return t;
    });
    if (changed) await SGW.store.saveTasks(tasks);
    return changed;
  },
};

SGW.util = {
  uid: function () {
    return "t" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  },
  alarmName: function (id) { return "sg-" + id; },

  sendToTab: function (tabId, msg, timeoutMs) {
    return new Promise(function (resolve) {
      var done = false;
      var timer = setTimeout(function () {
        if (!done) { done = true; resolve({ ok: false, error: "timeout" }); }
      }, timeoutMs || 20000);
      chrome.tabs.sendMessage(tabId, msg, function (resp) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        if (chrome.runtime.lastError) {
          resolve({ ok: false, error: chrome.runtime.lastError.message });
        } else {
          resolve(resp || { ok: false, error: "empty-response" });
        }
      });
    });
  },

  waitForTabComplete: function (tabId, timeoutMs) {
    return new Promise(function (resolve) {
      var done = false;
      var timer = setTimeout(function () {
        if (!done) { done = true; chrome.tabs.onUpdated.removeListener(onU); resolve(false); }
      }, timeoutMs || 45000);
      function onU(id, info) {
        if (id === tabId && info.status === "complete") {
          if (!done) {
            done = true;
            clearTimeout(timer);
            chrome.tabs.onUpdated.removeListener(onU);
            resolve(true);
          }
        }
      }
      chrome.tabs.onUpdated.addListener(onU);
      chrome.tabs.get(tabId, function (tab) {
        if (chrome.runtime.lastError) return;
        if (tab && tab.status === "complete" && !done) {
          done = true;
          clearTimeout(timer);
          chrome.tabs.onUpdated.removeListener(onU);
          resolve(true);
        }
      });
    });
  },

  async notify(title, message) {
    try {
      await chrome.notifications.create({
        type: "basic",
        iconUrl: "icons/icon128.png",
        title: title,
        message: String(message).slice(0, 180),
        priority: 2,
      });
    } catch (e) { /* notifications unavailable — badge still updates */ }
  },

  async setBadge() {
    var tasks = await SGW.store.getTasks();
    var anyEnabled = tasks.some(function (t) { return t.enabled; });
    var needUser = tasks.some(function (t) { return t.enabled && t.status === "NEEDS_USER"; });
    var needTab = tasks.some(function (t) { return t.enabled && t.status === "NEEDS_TAB"; });
    var text = "·", color = "#616161";
    if (needUser) { text = "!"; color = "#c62828"; }
    else if (needTab) { text = "~"; color = "#f9a825"; }
    else if (anyEnabled) { text = "ON"; color = "#2e7d32"; }
    try {
      await chrome.action.setBadgeText({ text: text });
      await chrome.action.setBadgeBackgroundColor({ color: color });
    } catch (e) { /* ignore */ }
  },
};

SGW.check = {
  async findTab(task) {
    try {
      var tabs = await chrome.tabs.query({ url: task.urlPattern });
      return tabs && tabs.length ? tabs[0] : null;
    } catch (e) {
      return null;
    }
  },

  async ensureTab(task) {
    var tab = await SGW.check.findTab(task);
    if (tab) return tab;
    if (!task.openUrl) return null;
    var created = await chrome.tabs.create({ url: task.openUrl, active: false });
    var ok = await SGW.util.waitForTabComplete(created.id, 45000);
    return ok ? created : null;
  },

  async run(taskId) {
    var task = await SGW.store.getTask(taskId);
    if (!task || !task.enabled) return { skipped: true };
    if (task.status === "NEEDS_USER") {
      // Re-probe: maybe the user solved the challenge manually.
    }

    var tab = await SGW.check.ensureTab(task);
    if (!tab) {
      await SGW.store.updateTask(taskId, {
        status: "NEEDS_TAB",
        statusDetail: "No matching tab open and no openUrl set. Open the page once.",
        lastCheck: Date.now(),
      });
      await SGW.util.setBadge();
      return { skipped: true, reason: "no-tab" };
    }

    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ["src/content/checker.js"],
      });
    } catch (e) {
      await SGW.store.updateTask(taskId, {
        status: "ERROR", statusDetail: "Cannot inject into tab: " + e.message,
        lastCheck: Date.now(),
      });
      await SGW.util.setBadge();
      return { error: "inject-failed" };
    }

    var snap = await SGW.util.sendToTab(tab.id, { type: "SG_CHECK", selector: task.selector }, 25000);
    if (!snap || snap.ok === false) {
      await SGW.store.updateTask(taskId, {
        status: "ERROR",
        statusDetail: "Check failed: " + ((snap && (snap.detail || snap.error)) || "no response"),
        lastCheck: Date.now(),
      });
      await SGW.util.setBadge();
      return { error: "check-failed" };
    }

    // Safety rule: bot check detected → pause, ask the human.
    var challenge = snap.challenge ? snap.challengeKind : SG.detector.detectChallenge(snap);
    if (challenge) {
      await SGW.store.updateTask(taskId, {
        status: "NEEDS_USER",
        statusDetail: "Bot check detected (" + challenge + "). Solve it in the tab — checks resume on their own.",
        lastCheck: Date.now(),
      });
      await SGW.util.setBadge();
      await SGW.util.notify(
        "slot-guard paused: " + task.name,
        "A bot check appeared. Solve it in the browser tab and monitoring will resume by itself."
      );
      return { paused: true, reason: challenge };
    }

    var ev = SG.detector.evaluate(task, snap.matches, task.last || null);
    var patch = {
      status: "OK", statusDetail: ev.detail, lastCheck: Date.now(),
      last: { count: ev.count, signature: ev.signature },
    };
    var alerted = false;
    if (ev.changed && task.last) {
      alerted = true;
      await SGW.util.notify("slot-guard: " + task.name, ev.detail + " — " + SG.detector.summarize(snap.matches));
    } else if (!task.last) {
      patch.statusDetail = "Watching. " + ev.detail;
    }
    await SGW.store.updateTask(taskId, patch);
    await SGW.util.setBadge();
    return { ok: true, changed: ev.changed, alerted: alerted };
  },

  async schedule(task) {
    await chrome.alarms.clear(SGW.util.alarmName(task.id));
    if (task.enabled) {
      await chrome.alarms.create(SGW.util.alarmName(task.id), {
        periodInMinutes: Math.max(1, Math.min(1440, Number(task.intervalMin) || 30)),
      });
    }
  },

  async rescheduleAll() {
    var tasks = await SGW.store.getTasks();
    for (var i = 0; i < tasks.length; i++) await SGW.check.schedule(tasks[i]);
    await SGW.util.setBadge();
  },
};

chrome.alarms.onAlarm.addListener(function (alarm) {
  if (alarm.name.indexOf("sg-") === 0) {
    SGW.check.run(alarm.name.slice(3)).catch(function (e) {
      console.warn("slot-guard check failed:", e);
    });
  }
});

chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
  (async function () {
    if (!msg || !msg.type) return { ok: false };
    if (msg.type === "SG_RUN_NOW") {
      return await SGW.check.run(msg.id);
    }
    if (msg.type === "SG_RESCHEDULE") {
      await SGW.check.rescheduleAll();
      return { ok: true };
    }
    if (msg.type === "SG_TEST_SELECTOR") {
      // Used by the options page: inject + snapshot the active tab.
      var tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      var tab = tabs && tabs[0];
      if (!tab) return { ok: false, error: "no-active-tab" };
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id }, files: ["src/content/checker.js"],
        });
      } catch (e) {
        return { ok: false, error: "inject-failed", detail: String(e.message) };
      }
      var snap = await SGW.util.sendToTab(tab.id, { type: "SG_TEST", selector: msg.selector }, 15000);
      return snap;
    }
    return { ok: false, error: "unknown-message" };
  })().then(sendResponse);
  return true; // async response
});

chrome.runtime.onInstalled.addListener(function () {
  SGW.check.rescheduleAll().catch(function (e) { console.warn(e); });
});
chrome.runtime.onStartup.addListener(function () {
  SGW.check.rescheduleAll().catch(function (e) { console.warn(e); });
});
