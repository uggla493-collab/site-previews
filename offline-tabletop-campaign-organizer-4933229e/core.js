/* Lantern Ledger — original, dependency-free campaign organizer. */
(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.Ledger = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  const KEY = "lantern-ledger.v1";
  const MAX_BYTES = 4 * 1024 * 1024;
  const kinds = ["sessions", "npcs", "locations", "hooks"];
  const schemas = {
    campaign: ["id", "name", "premise", "notes", ...kinds],
    sessions: ["id", "title", "date", "summary", "notes", "nextSteps"],
    npcs: ["id", "name", "role", "location", "notes"],
    locations: ["id", "name", "description", "notes"],
    hooks: ["id", "title", "status", "notes"]
  };
  const copy = value => JSON.parse(JSON.stringify(value));
  function bytes(text) { return new TextEncoder().encode(text).length; }
  function fail(message) { throw new Error(message); }
  function object(value, keys, path) {
    if (!value || typeof value !== "object" || Array.isArray(value)) fail(path + " must be an object.");
    if (Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key)) ||
        Object.keys(value).some(key => !keys.includes(key))) fail(path + " has missing or unknown fields.");
  }
  function string(value, path, max, required) {
    if (typeof value !== "string" || value.length > max || (required && !value.trim()))
      fail(path + " must be " + (required ? "non-empty " : "") + "text, at most " + max + " characters.");
  }
  function validDate(value) {
    if (value === "") return true;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.slice(0,4) === "0000") return false;
    const date = new Date(value + "T00:00:00Z");
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0,10) === value;
  }
  function validate(value) {
    object(value, ["format", "version", "campaigns"], "Backup");
    if (value.format !== "lantern-ledger" || value.version !== 1) fail("Unsupported backup format or version.");
    if (!Array.isArray(value.campaigns) || value.campaigns.length > 50) fail("Backup must contain at most 50 campaigns.");
    const ids = new Set();
    function item(record, kind, path) {
      object(record, schemas[kind], path);
      if (typeof record.id !== "string" || !/^[A-Za-z0-9_-]{1,90}$/.test(record.id) || ids.has(record.id))
        fail(path + " has an invalid or duplicate ID.");
      ids.add(record.id);
      for (const key of schemas[kind]) {
        if (key === "id" || kinds.includes(key)) continue;
        string(record[key], path + "." + key, ["name", "title", "role", "location"].includes(key) ? 180 : 40000,
          key === "name" || key === "title");
      }
      if (kind === "sessions" && !validDate(record.date)) fail(path + " has an invalid date.");
      if (kind === "hooks" && !["open", "resolved"].includes(record.status)) fail(path + " has an invalid hook status.");
    }
    value.campaigns.forEach((campaign, index) => {
      const path = "Campaign " + (index + 1);
      item(campaign, "campaign", path);
      kinds.forEach(kind => {
        if (!Array.isArray(campaign[kind]) || campaign[kind].length > 500)
          fail(path + "." + kind + " must contain at most 500 records.");
        campaign[kind].forEach((record, n) => item(record, kind, path + "." + kind + "[" + n + "]"));
      });
    });
    if (bytes(JSON.stringify(value)) > MAX_BYTES) fail("Data exceeds the 4 MiB limit. Split or reduce your archive.");
    return copy(value);
  }
  function parse(text) {
    if (typeof text !== "string" || bytes(text) > MAX_BYTES) fail("Backup must be a JSON file no larger than 4 MiB.");
    let value;
    try { value = JSON.parse(text); } catch (_) { fail("This file is not valid JSON. Existing data has not changed."); }
    return validate(value);
  }
  function serialize(value) { return JSON.stringify(validate(value)); }
  function id() {
    if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
    return "id_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2);
  }
  function empty() { return { format: "lantern-ledger", version: 1, campaigns: [] }; }
  function blank(kind) {
    if (!Object.hasOwn(schemas, kind)) fail("Unknown record type.");
    const value = {};
    schemas[kind].forEach(key => { value[key] = key === "id" ? id() : kinds.includes(key) ? [] : ""; });
    if (kind === "hooks") value.status = "open";
    return value;
  }
  function mutate(data, operation) {
    const next = validate(data);
    operation(next);
    return validate(next);
  }
  function campaignIn(data, campaignId) {
    const campaign = data.campaigns.find(c => c.id === campaignId);
    if (!campaign) fail("Campaign no longer exists.");
    return campaign;
  }
  function saveCampaign(data, record) {
    return mutate(data, next => {
      const index = next.campaigns.findIndex(c => c.id === record.id);
      if (index < 0) next.campaigns.push(copy(record));
      else next.campaigns[index] = copy(record);
    });
  }
  function removeCampaign(data, campaignId) {
    return mutate(data, next => {
      campaignIn(next, campaignId);
      next.campaigns = next.campaigns.filter(c => c.id !== campaignId);
    });
  }
  function saveRecord(data, campaignId, kind, record) {
    if (!kinds.includes(kind)) fail("Unknown record type.");
    return mutate(data, next => {
      const list = campaignIn(next, campaignId)[kind];
      const index = list.findIndex(r => r.id === record.id);
      if (index < 0) list.push(copy(record)); else list[index] = copy(record);
    });
  }
  function removeRecord(data, campaignId, kind, recordId) {
    if (!kinds.includes(kind)) fail("Unknown record type.");
    return mutate(data, next => {
      const campaign = campaignIn(next, campaignId);
      if (!campaign[kind].some(r => r.id === recordId)) fail("Record no longer exists.");
      campaign[kind] = campaign[kind].filter(r => r.id !== recordId);
    });
  }
  function search(data, query) {
    const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length) return [];
    const results = [];
    function consider(campaign, kind, record) {
      const haystack = Object.entries(record).filter(([key, value]) => key !== "id" && typeof value === "string")
        .map(([, value]) => value).join(" ").toLocaleLowerCase();
      if (terms.every(term => haystack.includes(term))) results.push({ campaignId: campaign.id, kind, record: copy(record) });
    }
    data.campaigns.forEach(c => {
      consider(c, "campaign", c);
      kinds.forEach(kind => c[kind].forEach(r => consider(c, kind, r)));
    });
    return results;
  }
  function sessionSummary(data, campaignId, sessionId) {
    const c = campaignIn(data, campaignId);
    const s = c.sessions.find(r => r.id === sessionId);
    if (!s) fail("Choose a saved session to print.");
    return copy({ campaign: c.name, premise: c.premise, session: s,
      hooks: c.hooks.filter(h => h.status === "open") });
  }
  class Repository {
    constructor(storage) { this.storage = storage; this.data = empty(); this.raw = null; this.volatile = !storage; }
    load(seed) {
      if (!this.storage) { this.data = validate(seed); return this.data; }
      this.raw = this.storage.getItem(KEY);
      if (this.raw !== null) this.data = parse(this.raw);
      else this.data = validate(seed);
      return this.data;
    }
    commit(next) {
      const checked = validate(next);
      const text = serialize(checked);
      if (this.storage) {
        if (this.storage.getItem(KEY) !== this.raw) fail("Another tab changed this archive. Export this tab's data, then reload before editing.");
        this.storage.setItem(KEY, text); // Only advance in-memory state after the atomic write succeeds.
      }
      this.data = checked;
      this.raw = text;
      return this.data;
    }
    restore(text) { return this.commit(parse(text)); }
    export() { return serialize(this.data); }
  }
  function sample() {
    return {
      format: "lantern-ledger", version: 1,
      campaigns: [{
        id: "sample-campaign", name: "The Tideglass Lantern",
        premise: "On the salt flats of Oris, a lighthouse shines inland once every thirteen nights. Its light reveals streets from a town nobody remembers building.",
        notes: "An original, system-neutral mystery about memory, shared promises, and a changing coastline.\nTable agreement: keep peril adventurous; pause or fade out any scene that makes someone uncomfortable.\nQuestions for the table: What did you leave at sea? Who remembers your first name?",
        sessions: [
          { id: "sample-session-1", title: "A street beneath the salt", date: "",
            summary: "The travelers arrived at Bellwether Quay as the tideglass lantern turned inland. A street of blue doors appeared across the flats. Sera offered a map with a blank center.",
            notes: "Opening image: a paper boat circles a dry fountain.\nDiscoveries: the blue doors bear tomorrow's dates; the lighthouse keeper has not been seen for three nights.\nDecision: follow the bell rope beneath the quay before crossing the flats.",
            nextSteps: "Ask who recognizes the song from the dry fountain. Let the group choose whether to visit Iven's workshop or the exposed street first." },
          { id: "sample-session-2", title: "The keeper's unwritten letter", date: "",
            summary: "", notes: "Preparation: Iven has a sealed envelope containing only salt. When held near the lantern, a sentence appears: 'Return what we agreed to forget.'",
            nextSteps: "Find out whose promise powers the lantern. Offer a quiet negotiation before any dangerous crossing." }
        ],
        npcs: [
          { id: "sample-npc-1", name: "Sera Venn", role: "Cartographer of disappearing roads", location: "Bellwether Quay",
            notes: "Wears a coat lined with failed maps. Wants to find her brother's workshop, which vanished from every street but not from her memory.\nVoice: exact directions, uncertain names.\nSecret: she drew the lantern's first inland path." },
          { id: "sample-npc-2", name: "Iven of the Copper Hands", role: "Retired bellmaker", location: "The Quiet Foundry",
            notes: "Repairs small objects without asking payment. Wants the quay's bell to ring once more.\nCarries copper gloves to hide the blue salt on his fingertips. Knows the keeper left willingly." }
        ],
        locations: [
          { id: "sample-place-1", name: "Bellwether Quay", description: "A harbor stranded above a retreating sea. Wind threads the empty mooring rings and makes them hum.",
            notes: "Sensory cues: warm stone, kelp smoke, a bell rope dropping through a locked hatch.\nUseful detail: the tide table contains a thirteenth column." },
          { id: "sample-place-2", name: "The Quiet Foundry", description: "A roofless workshop where unfinished bells collect rainwater that never evaporates.",
            notes: "Iven keeps the smallest bell wrapped in a map. A blue door appears behind the furnace when the inland beam passes." }
        ],
        hooks: [
          { id: "sample-hook-1", title: "Who is ringing beneath the quay?", status: "open",
            notes: "The bell rope moves at noon, though the bell was sold years ago. A fresh knot bears Sera's initials." },
          { id: "sample-hook-2", title: "The town missing from the maps", status: "open",
            notes: "Choose a door on the salt flats. Each remembers a different version of the travelers' arrival." },
          { id: "sample-hook-3", title: "A berth for the night", status: "resolved",
            notes: "The quay steward offered the old signal room after the travelers repaired its shutter." }
        ]
      }]
    };
  }
  return { KEY, MAX_BYTES, kinds, copy, bytes, validate, parse, serialize, validDate, blank, empty, sample,
    saveCampaign, removeCampaign, saveRecord, removeRecord, search, sessionSummary, Repository };
});
