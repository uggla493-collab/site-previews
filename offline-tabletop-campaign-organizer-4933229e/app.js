/* UI uses textContent throughout: imported text is never rendered as HTML. */
(function () {
  "use strict";
  const L = window.Ledger;
  const $ = id => document.getElementById(id);
  const titles = { sessions: "Sessions", npcs: "NPCs", locations: "Locations", hooks: "Hooks" };
  const singular = { campaign: "campaign", sessions: "session", npcs: "NPC", locations: "location", hooks: "hook" };
  const descriptions = {
    sessions: "What happened, what matters, and what comes next.",
    npcs: "The people your players will remember.",
    locations: "Places with something waiting to be discovered.",
    hooks: "Unfinished promises, unanswered questions, and resolved threads."
  };
  let repo, campaignId, tab = "overview", editing = null, dirty = false, pendingRestore = null, recovering = false;
  let importGeneration = 0;
  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function button(text, action, className) {
    const node = el("button", className, text); node.type = "button"; node.addEventListener("click", action); return node;
  }
  function notice(message, error = false) { $("notice").textContent = message; $("notice").classList.toggle("error", error); }
  function current() { return repo.data.campaigns.find(c => c.id === campaignId); }
  function saveStatus() {
    $("save-status").textContent = recovering ? "Editing paused · original archive preserved" :
      repo.volatile ? "TEMPORARY MODE · data lives in this tab only. Export before closing." :
      "Saved in this browser · " + new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  function save(next) {
    if (recovering) throw new Error("Restore a valid backup before editing.");
    try { repo.commit(next); }
    catch (error) {
      if (error.name === "QuotaExceededError") throw new Error("Browser storage is full. Your previous save is intact; these edits are not saved. Shorten this entry or cancel and export your archive before freeing space.");
      throw error;
    }
    saveStatus();
  }
  function init() {
    let storage = null;
    try { storage = window.localStorage; } catch (_) { /* Explicitly reported temporary mode below. */ }
    repo = new L.Repository(storage);
    try {
      repo.load(L.sample());
      if (storage && repo.raw === null) repo.commit(repo.data);
    } catch (error) {
      if (repo.raw !== null) {
        recovering = true;
        $("recovery").hidden = false;
        $("recovery-message").textContent = "The saved data could not be read: " + error.message;
        notice("The original archive has not been changed. Use the recovery controls below.", true);
      } else {
        repo = new L.Repository(null);
        repo.load(L.sample());
      }
    }
    if (repo.volatile) notice("Browser storage is unavailable. You can edit in temporary mode, but everything in this tab will be lost when it closes. Export a JSON backup to keep your work.", true);
    campaignId = repo.data.campaigns[0]?.id;
    saveStatus(); render();
  }
  function render() {
    const c = current();
    $("campaign-count").textContent = repo.data.campaigns.length;
    $("campaign-list").replaceChildren();
    repo.data.campaigns.forEach(campaign => {
      const b = button("", () => { campaignId = campaign.id; tab = "overview"; $("search").value = ""; render(); }, "campaign-link");
      b.append(el("span", "", campaign.name), el("small", "", campaign.sessions.length + " sessions · " + campaign.hooks.filter(h => h.status === "open").length + " open hooks"));
      if (campaign.id === campaignId) b.setAttribute("aria-current", "page");
      $("campaign-list").append(b);
    });
    $("new-campaign").disabled = recovering;
    $("empty-new").disabled = recovering;
    $("export-button").disabled = recovering;
    $("empty-library").hidden = !!c || recovering;
    $("campaign-content").hidden = !c;
    if (c) {
      $("campaign-title").textContent = c.name;
      $("campaign-premise").textContent = c.premise || "Give this campaign a premise with Edit campaign.";
      for (const kind of L.kinds) $("count-" + kind).textContent = c[kind].length;
      document.querySelectorAll("[data-tab]").forEach(b => {
        if (b.dataset.tab === tab) b.setAttribute("aria-current", "page");
        else b.removeAttribute("aria-current");
      });
      $("overview").hidden = tab !== "overview";
      $("records-panel").hidden = tab === "overview";
      $("print-button").disabled = !c.sessions.length;
      if (tab === "overview") renderOverview(c);
      else renderRecords(c);
    }
    renderSearch();
  }
  function renderOverview(c) {
    const root = $("overview"); root.replaceChildren();
    const stats = el("div", "stats");
    [["Sessions", c.sessions.length], ["People", c.npcs.length], ["Places", c.locations.length], ["Open hooks", c.hooks.filter(h => h.status === "open").length]].forEach(([label, count]) => {
      const stat = el("div", "stat"); stat.append(el("strong", "", count), el("span", "", label)); stats.append(stat);
    });
    const grid = el("div", "overview-grid");
    const notes = el("section", "panel"); notes.append(el("div", "eyebrow", "THE BIG PICTURE"), el("h2", "", "Campaign notes"), el("p", "note-text", c.notes || "Add table agreements, themes, and the details you want to remember."), button("Edit notes", () => openEditor("campaign", c), "quiet"));
    const hooks = el("section", "panel"); hooks.append(el("div", "eyebrow", "STILL IN MOTION"), el("h2", "", "Unresolved hooks"));
    const open = c.hooks.filter(h => h.status === "open");
    if (!open.length) hooks.append(el("p", "muted", "No loose ends yet. Add a question worth following."));
    open.slice(0, 4).forEach(hook => {
      const row = el("div", "hook-line"); row.append(el("h3", "", hook.title), el("p", "preview-text", hook.notes), button("Open hook", () => openEditor("hooks", hook), "quiet")); hooks.append(row);
    });
    hooks.append(button(open.length > 4 ? "View all " + open.length + " open hooks" : "Manage hooks", () => { tab = "hooks"; $("hook-filter").value = "open"; render(); }, "quiet"));
    grid.append(notes, hooks); root.append(stats, grid);
  }
  function card(kind, record, campaign) {
    const node = el("article", "card");
    let tag = kind === "sessions" ? record.date || "Undated session" :
      kind === "hooks" ? record.status === "open" ? "Unresolved" : "Resolved" :
      kind === "npcs" ? record.role || "Character" : "Place";
    node.append(el("span", "tag" + (kind === "hooks" && record.status === "open" ? " open" : ""), tag));
    node.append(el("h3", "", record.name || record.title));
    if (kind === "npcs" && record.location) node.append(el("p", "muted", record.location));
    const preview = kind === "sessions" ? record.summary || record.notes : kind === "locations" ? record.description || record.notes : record.notes;
    node.append(el("p", "preview-text", preview || "No notes yet. Open this entry to add some."));
    const actions = el("div", "card-actions");
    actions.append(button("Open / edit", () => openEditor(kind, record)));
    if (kind === "hooks") actions.append(button(record.status === "open" ? "Resolve" : "Reopen", () => {
      try {
        const updated = { ...record, status: record.status === "open" ? "resolved" : "open" };
        save(L.saveRecord(repo.data, campaign.id, kind, updated));
        render(); notice(updated.status === "open" ? "Hook reopened." : "Hook resolved.");
      } catch (error) { notice(error.message, true); }
    }, "quiet"));
    if (kind === "sessions") actions.append(button("Print", () => openPrint(record.id), "quiet"));
    actions.append(button("Delete", () => {
      if (!window.confirm('Delete "' + (record.name || record.title) + '"? This cannot be undone.')) return;
      try { save(L.removeRecord(repo.data, campaign.id, kind, record.id)); render(); notice("Entry deleted."); }
      catch (error) { notice(error.message, true); }
    }, "danger quiet"));
    node.append(actions); return node;
  }
  function renderRecords(c) {
    $("records-title").textContent = titles[tab];
    $("records-description").textContent = descriptions[tab];
    $("add-record").textContent = "+ New " + singular[tab];
    $("hook-filter-row").hidden = tab !== "hooks";
    const list = $("record-list"); list.replaceChildren();
    let records = c[tab];
    if (tab === "hooks" && $("hook-filter").value !== "all") records = records.filter(h => h.status === $("hook-filter").value);
    if (!records.length) {
      const empty = el("div", "empty"); empty.append(el("h2", "", "Room for a new thread"), el("p", "", tab === "hooks" ? "No hooks match this view. Change the filter or add a new hook." : "Add your first " + singular[tab] + " to this campaign.")); list.append(empty);
    }
    records.forEach(record => list.append(card(tab, record, c)));
  }
  function renderSearch() {
    const query = $("search").value.trim();
    $("search-panel").hidden = !query; $("campaign-panel").hidden = !!query;
    $("clear-search").hidden = !query;
    if (!query) return;
    const results = L.search(repo.data, query);
    $("search-count").textContent = results.length + " result" + (results.length === 1 ? "" : "s");
    $("search-results").replaceChildren();
    if (!results.length) $("search-results").append(el("p", "empty", "No matching entries. Try fewer words or another spelling."));
    results.forEach(result => {
      const c = repo.data.campaigns.find(c => c.id === result.campaignId);
      const node = el("article", "card");
      node.append(el("span", "tag", singular[result.kind]), el("h3", "", result.record.name || result.record.title), el("p", "muted", c.name),
        el("p", "preview-text", result.record.summary || result.record.description || result.record.premise || result.record.notes),
        button("Open result", () => {
          campaignId = c.id; tab = result.kind === "campaign" ? "overview" : result.kind;
          $("search").value = ""; render(); openEditor(result.kind, result.record);
        }));
      $("search-results").append(node);
    });
  }
  const fields = {
    campaign: [["name", "Campaign name", "input"], ["premise", "Premise", "textarea"], ["notes", "Campaign notes & table agreements", "textarea"]],
    sessions: [["title", "Session title", "input"], ["date", "Session date (optional)", "date"], ["summary", "What happened · summary", "textarea"], ["notes", "Private preparation notes", "textarea"], ["nextSteps", "Next steps", "textarea"]],
    npcs: [["name", "Name", "input"], ["role", "Role", "input"], ["location", "Location", "input"], ["notes", "Notes, motives & secrets", "textarea"]],
    locations: [["name", "Location name", "input"], ["description", "Description", "textarea"], ["notes", "Notes & discoveries", "textarea"]],
    hooks: [["title", "Hook title", "input"], ["status", "Status", "select"], ["notes", "Clues & notes", "textarea"]]
  };
  function openEditor(kind, record) {
    if (recovering) return;
    editing = { kind, campaignId, record: L.copy(record || L.blank(kind)) };
    dirty = false;
    $("editor-title").textContent = (record ? "Edit " : "New ") + singular[kind];
    $("editor-fields").replaceChildren(); $("editor-error").textContent = "";
    fields[kind].forEach(([key, title, type]) => {
      const wrapper = el("div", "field");
      const label = el("label", "", title); label.htmlFor = "field-" + key;
      const control = el(type === "textarea" ? "textarea" : type === "select" ? "select" : "input");
      control.id = "field-" + key; control.name = key;
      if (type === "date") control.type = "date";
      if (type === "select") [["open", "Unresolved"], ["resolved", "Resolved"]].forEach(([value, text]) => {
        const option = el("option", "", text); option.value = value; control.append(option);
      });
      control.value = editing.record[key];
      if (key === "name" || key === "title") control.required = true;
      if (type === "input") control.maxLength = 180;
      if (type === "textarea") { control.maxLength = 40000; control.rows = key === "notes" ? 6 : 4; }
      control.addEventListener("input", () => { dirty = true; });
      wrapper.append(label, control);
      if (type === "textarea") wrapper.append(el("small", "", "Plain text · line breaks preserved · up to 40,000 characters"));
      $("editor-fields").append(wrapper);
    });
    $("editor").showModal();
    $("editor-fields").querySelector("input,textarea,select")?.focus();
  }
  function closeEditor() {
    if (dirty && !window.confirm("Discard these unsaved edits?")) return;
    $("editor").close(); dirty = false; editing = null;
  }
  $("editor-form").addEventListener("submit", event => {
    event.preventDefault();
    if (!editing) return;
    const record = L.copy(editing.record);
    fields[editing.kind].forEach(([key]) => { record[key] = $("field-" + key).value; });
    try {
      const next = editing.kind === "campaign" ? L.saveCampaign(repo.data, record) : L.saveRecord(repo.data, editing.campaignId, editing.kind, record);
      save(next);
      if (editing.kind === "campaign") campaignId = record.id;
      dirty = false; editing = null; $("editor").close(); render();
      notice(repo.volatile ? "Saved in this tab only. Export a backup before closing." : "Saved to your browser.");
    } catch (error) { $("editor-error").textContent = error.message; }
  });
  $("editor-close").addEventListener("click", closeEditor);
  $("editor-cancel").addEventListener("click", closeEditor);
  $("editor").addEventListener("cancel", event => { event.preventDefault(); closeEditor(); });
  window.addEventListener("beforeunload", event => { if (dirty) { event.preventDefault(); event.returnValue = ""; } });
  function download(text, filename) {
    const url = URL.createObjectURL(new Blob([text], { type: "application/json;charset=utf-8" }));
    const a = el("a"); a.href = url; a.download = filename; document.body.append(a); a.click(); a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
  function exportBackup() {
    if (recovering) { notice("Download the unreadable archive from the recovery panel first.", true); return; }
    try {
      download(repo.export(), "lantern-ledger-" + new Date().toISOString().replace(/[:.]/g, "-") + ".json");
      $("backup-status").textContent = "Backup download requested · check that the file exists in Downloads.";
      notice("Backup download requested. Check the downloaded JSON exists, then keep a second copy somewhere safe.");
    } catch (error) { notice(error.message, true); }
  }
  $("export-button").addEventListener("click", exportBackup);
  $("restore-export").addEventListener("click", exportBackup);
  $("download-raw").addEventListener("click", () => download(repo.raw || "", "lantern-ledger-unreadable-" + Date.now() + ".json"));
  $("import-file").addEventListener("change", async event => {
    const file = event.target.files[0]; event.target.value = "";
    if (!file) return;
    const generation = ++importGeneration;
    pendingRestore = null;
    if ($("restore-dialog").open) $("restore-dialog").close();
    try {
      if (file.size > L.MAX_BYTES) throw new Error("Backup exceeds the 4 MiB limit.");
      const text = await file.text();
      if (generation !== importGeneration) return;
      pendingRestore = L.parse(text);
      const counts = L.kinds.map(kind => pendingRestore.campaigns.reduce((sum, c) => sum + c[kind].length, 0) + " " + titles[kind].toLowerCase());
      $("restore-summary").textContent = "Validated backup: " + pendingRestore.campaigns.length + " campaigns, " + counts.join(", ") + ".";
      $("restore-error").textContent = "";
      $("restore-export").disabled = recovering;
      $("restore-dialog").showModal();
    } catch (error) {
      if (generation !== importGeneration) return;
      pendingRestore = null; notice("Restore rejected: " + error.message + " Your existing data is unchanged.", true);
    }
  });
  $("restore-cancel").addEventListener("click", () => { importGeneration++; pendingRestore = null; $("restore-dialog").close(); });
  $("restore-dialog").addEventListener("cancel", () => { importGeneration++; pendingRestore = null; });
  $("restore-confirm").addEventListener("click", () => {
    if (!pendingRestore) return;
    try {
      repo.commit(pendingRestore);
      pendingRestore = null; recovering = false; $("recovery").hidden = true; $("restore-dialog").close();
      campaignId = repo.data.campaigns[0]?.id; tab = "overview"; $("search").value = "";
      saveStatus(); render(); notice(repo.volatile ? "Backup restored to this tab only. Storage is unavailable; export before closing." : "Backup restored. Your library is saved in this browser.");
    } catch (error) { $("restore-error").textContent = "Restore failed; existing data is unchanged. " + error.message; }
  });
  function printArticle() {
    const article = el("article", "print-sheet");
    const c = current();
    if (!c || !c.sessions.length) { article.append(el("h1", "", "No saved session"), el("p", "", "Create and save a session, then choose Print session.")); return article; }
    const sessionId = $("print-session").value || c.sessions[0].id;
    const summary = L.sessionSummary(repo.data, c.id, c.sessions.some(s => s.id === sessionId) ? sessionId : c.sessions[0].id);
    article.append(el("p", "print-meta", "LANTERN LEDGER · SESSION SUMMARY"), el("h1", "", summary.session.title),
      el("p", "print-meta", summary.campaign + " · " + (summary.session.date || "Undated session")));
    [["Campaign premise", summary.premise], ["What happened", summary.session.summary || "No summary recorded."],
      ["Next steps", summary.session.nextSteps || "No next steps recorded."]].forEach(([label, text]) => {
      article.append(el("h2", "", label), el("p", "", text));
    });
    if ($("print-dialog").open && $("print-private").checked) article.append(el("h2", "", "Private preparation notes"), el("p", "", summary.session.notes || "No preparation notes recorded."));
    article.append(el("h2", "", "Currently unresolved hooks"));
    if (!summary.hooks.length) article.append(el("p", "", "No unresolved hooks."));
    summary.hooks.forEach(h => article.append(el("h3", "", h.title), el("p", "", h.notes || "No notes recorded.")));
    article.append(el("p", "print-meta", "Snapshot of saved entries · " + new Date().toLocaleDateString()));
    return article;
  }
  function renderPrint() {
    const article = printArticle();
    $("print-preview").replaceChildren(article);
    $("print-output").replaceChildren(article.cloneNode(true));
  }
  function openPrint(sessionId) {
    const c = current(); if (!c?.sessions.length) return;
    $("print-session").replaceChildren();
    c.sessions.forEach(s => { const option = el("option", "", s.title + (s.date ? " · " + s.date : "")); option.value = s.id; $("print-session").append(option); });
    $("print-session").value = sessionId || c.sessions[0].id;
    $("print-private").checked = false;
    renderPrint(); $("print-dialog").showModal();
  }
  $("print-session").addEventListener("change", renderPrint);
  $("print-private").addEventListener("change", renderPrint);
  $("print-now").addEventListener("click", () => { renderPrint(); window.print(); });
  function resetPrintPrivacy() { $("print-private").checked = false; }
  $("print-close").addEventListener("click", () => { resetPrintPrivacy(); $("print-dialog").close(); });
  $("print-dialog").addEventListener("cancel", resetPrintPrivacy);
  $("print-dialog").addEventListener("close", resetPrintPrivacy);
  window.addEventListener("beforeprint", renderPrint);
  $("print-button").addEventListener("click", () => openPrint());
  $("new-campaign").addEventListener("click", () => openEditor("campaign"));
  $("empty-new").addEventListener("click", () => openEditor("campaign"));
  $("edit-campaign").addEventListener("click", () => openEditor("campaign", current()));
  $("delete-campaign").addEventListener("click", () => {
    const c = current();
    if (!window.confirm('Delete campaign "' + c.name + '" and all its sessions, NPCs, locations, and hooks? Export a backup first if you want to keep them. This cannot be undone.')) return;
    try { save(L.removeCampaign(repo.data, c.id)); campaignId = repo.data.campaigns[0]?.id; tab = "overview"; render(); notice("Campaign deleted."); }
    catch (error) { notice(error.message, true); }
  });
  $("add-record").addEventListener("click", () => openEditor(tab));
  $("hook-filter").addEventListener("change", render);
  document.querySelectorAll("[data-tab]").forEach(b => b.addEventListener("click", () => { tab = b.dataset.tab; render(); }));
  $("search").addEventListener("input", renderSearch);
  $("clear-search").addEventListener("click", () => { $("search").value = ""; render(); $("search").focus(); });
  $("help-button").addEventListener("click", () => $("help-dialog").showModal());
  $("help-close").addEventListener("click", () => $("help-dialog").close());
  window.addEventListener("storage", event => {
    if (event.key === L.KEY || event.key === null) notice("This archive changed in another tab. Export this tab's copy if needed, then reload. Further saves are blocked until you reload.", true);
  });
  init();
})();
