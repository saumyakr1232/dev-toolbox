// Feature: jump between environments of the same project while keeping path, query and hash.
//
// A project groups environments that serve the same app on different domains:
//   { id, name: "Dashboard", envs: [
//       { id, name: "Prod",  domain: "test.com",       color: "rose"  },
//       { id, name: "QA",    domain: "test-qa.com",    color: "amber" },
//       { id, name: "Local", domain: "localhost:3000", color: "violet" } ] }
//
// An env domain matches itself and any subdomain, and the subdomain is carried over:
//   https://app.test.com/dashboard/2?x=1  (Prod → QA)  https://app.test-qa.com/dashboard/2?x=1

const STORAGE_KEY = "projects";
const LEGACY_KEY = "domainRules";
const SETTINGS_KEY = "switchSettings";

// groupTabs: right-click switches open in a new tab grouped with the current one
// (off: they switch in place), and new tabs from the popup join that group too.
const DEFAULT_SETTINGS = { groupTabs: true };

export const COLORS = ["rose", "amber", "green", "blue", "violet", "slate"];

export function newId() {
  return crypto.randomUUID().slice(0, 8);
}

// Pick a sensible default colour from the env name, avoiding colours already used
// in the project; falls back to position.
export function suggestColor(name, index = 0, used = []) {
  const n = String(name).toLowerCase();
  const byName =
    /prod|live/.test(n) ? "rose" :
    /qa|test|uat/.test(n) ? "amber" :
    /stag|pre/.test(n) ? "blue" :
    /local|dev/.test(n) ? "violet" : null;
  if (byName && !used.includes(byName)) return byName;
  const free = COLORS.filter((c) => !used.includes(c));
  return free.length ? free[index % free.length] : COLORS[index % COLORS.length];
}

// Fixed IDs: menu items are looked up by ID on click, so defaults must not change between reads.
function defaultProjects() {
  return [
    {
      id: "example",
      name: "Example",
      envs: [
        { id: "example-prod", name: "Prod", domain: "test.com", color: "rose" },
        { id: "example-qa", name: "QA", domain: "test-qa.com", color: "amber" },
      ],
    },
  ];
}

export async function getProjects() {
  const data = await chrome.storage.sync.get(STORAGE_KEY);
  return data[STORAGE_KEY] ?? defaultProjects();
}

export async function saveProjects(projects) {
  await chrome.storage.sync.set({ [STORAGE_KEY]: projects });
}

export function onProjectsChanged(callback) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "sync" && changes[STORAGE_KEY]) callback(changes[STORAGE_KEY].newValue ?? []);
  });
}

export async function getSettings() {
  const data = await chrome.storage.sync.get(SETTINGS_KEY);
  return { ...DEFAULT_SETTINGS, ...data[SETTINGS_KEY] };
}

export async function saveSettings(settings) {
  await chrome.storage.sync.set({ [SETTINGS_KEY]: settings });
}

// ---- Domain helpers -------------------------------------------------------

// Normalise user input: strip scheme, path and trailing dots, lowercase.
export function cleanDomain(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/\.+$/, "");
}

export const DOMAIN_RE = /^[a-z0-9-]+(\.[a-z0-9-]+)*(:\d{1,5})?$/;

export function isValidDomain(value) {
  return DOMAIN_RE.test(cleanDomain(value));
}

function hostnameOf(domain) {
  return domain.replace(/:\d+$/, "");
}

function isLocalHost(host) {
  return host === "localhost" || host.endsWith(".localhost") || /^\d+(\.\d+){3}$/.test(host);
}

function parseHttpUrl(url) {
  try {
    const parsed = new URL(url);
    return /^https?:$/.test(parsed.protocol) ? parsed : null;
  } catch {
    return null;
  }
}

// How specifically `domain` matches `url`: 0 = no match, higher = more specific.
// Lets qa.test.com win over test.com when both are configured.
export function matchScore(domain, url) {
  const parsed = parseHttpUrl(url);
  const clean = cleanDomain(domain);
  if (!parsed || !isValidDomain(clean)) return 0;

  const host = hostnameOf(clean);
  const hasPort = clean !== host;
  // If the env specifies a port, the port must match too.
  if (hasPort && parsed.host !== clean && !parsed.host.endsWith("." + clean)) return 0;
  if (parsed.hostname !== host && !parsed.hostname.endsWith("." + host)) return 0;
  return host.length * 2 + (hasPort ? 1 : 0);
}

export function switchUrl(url, fromDomain, toDomain) {
  if (!matchScore(fromDomain, url) || !isValidDomain(toDomain)) return null;
  const parsed = new URL(url);
  const from = cleanDomain(fromDomain);
  const to = cleanDomain(toDomain);
  const fromHost = hostnameOf(from);
  const toHost = hostnameOf(to);
  // Carry the subdomain over ("app."), except onto localhost or an IP where it makes no sense.
  const bareTarget = toHost === "localhost" || /^\d+(\.\d+){3}$/.test(toHost);
  const subdomain = bareTarget ? "" : parsed.hostname.slice(0, parsed.hostname.length - fromHost.length);

  // Local dev servers are served over plain http; going back to a real domain means https.
  if (isLocalHost(toHost)) parsed.protocol = "http:";
  else if (isLocalHost(fromHost)) parsed.protocol = "https:";

  // Use the target's port if it has one; drop the source port if the env named it;
  // otherwise keep the original port.
  const toPort = to.slice(toHost.length + 1);
  const port = toPort || (from !== fromHost ? "" : parsed.port);
  // Setting `host` without a port does not clear an existing one, so set both explicitly.
  parsed.hostname = subdomain + toHost;
  parsed.port = port;
  return parsed.toString();
}

// Chrome match patterns used to show menu items only on relevant pages.
// Match patterns ignore ports, so "localhost:3000" becomes "*://localhost/*".
export function urlPatternsFor(domain) {
  const clean = cleanDomain(domain);
  if (!isValidDomain(clean)) return [];
  const host = hostnameOf(clean);
  return [`*://${host}/*`, `*://*.${host}/*`];
}

// ---- Projects & environments ---------------------------------------------

export function usableEnvs(project) {
  return project.envs.filter((env) => env.name?.trim() && isValidDomain(env.domain));
}

// The project and environment the URL belongs to (most specific match), or null.
export function findEnv(projects, url) {
  let best = null;
  for (const project of projects) {
    for (const env of usableEnvs(project)) {
      const score = matchScore(env.domain, url);
      if (score && (!best || score > best.score)) best = { project, env, score };
    }
  }
  return best && { project: best.project, env: best.env };
}

// Env colour -> nearest Chrome tab-group colour.
const GROUP_COLORS = { rose: "red", amber: "orange", green: "green", blue: "blue", violet: "purple", slate: "grey" };
const NO_GROUP = chrome.tabGroups?.TAB_GROUP_ID_NONE ?? -1;

export async function openEnv(tab, fromEnv, toEnv, { newTab = false, group = null } = {}) {
  if (fromEnv.id === toEnv.id) return false;
  const target = switchUrl(tab.url, fromEnv.domain, toEnv.domain);
  if (!target) return false;
  if (!newTab) {
    await chrome.tabs.update(tab.id, { url: target });
    return true;
  }
  const created = await chrome.tabs.create({ url: target, index: tab.index + 1, openerTabId: tab.id, active: true });
  if (group) await groupTabs(tab, created, group);
  return true;
}

// Put the original tab and the newly opened one in the same group. Reuses the
// original tab's group if it already has one; otherwise makes a fresh group
// named after the project and coloured like the target environment.
async function groupTabs(openerTab, newTab, { title, color }) {
  if (!chrome.tabs.group) return; // older Chrome without tab groups
  try {
    if (openerTab.groupId != null && openerTab.groupId !== NO_GROUP) {
      await chrome.tabs.group({ groupId: openerTab.groupId, tabIds: [newTab.id] });
      return;
    }
    const groupId = await chrome.tabs.group({ tabIds: [openerTab.id, newTab.id] });
    await chrome.tabGroups?.update(groupId, { title, color: GROUP_COLORS[color] ?? "grey" });
  } catch (err) {
    console.warn("Could not group tabs", err); // tab still opened; grouping is best-effort
  }
}

// ---- Migration from v1 one-way rules -------------------------------------

// Rules whose domains connect (a→b, b→a, b→c) become one project.
export function rulesToProjects(rules) {
  const parent = new Map();
  const find = (d) => (parent.get(d) === d ? d : find(parent.get(d)));
  const add = (d) => parent.has(d) || parent.set(d, d);

  const names = new Map(); // domain -> env name taken from a rule pointing at it
  for (const rule of rules) {
    const from = cleanDomain(rule.from);
    const to = cleanDomain(rule.to);
    if (!isValidDomain(from) || !isValidDomain(to)) continue;
    add(from);
    add(to);
    parent.set(find(from), find(to));
    const name = String(rule.name ?? "").trim().replace(/^(open|go|switch) (in|to) /i, "");
    if (name && !names.has(to)) names.set(to, name);
  }

  const groups = new Map();
  for (const domain of parent.keys()) {
    const root = find(domain);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(domain);
  }

  return [...groups.values()].map((domains, i) => ({
    id: newId(),
    name: `Project ${i + 1}`,
    envs: domains.reduce((envs, domain) => {
      const name = names.get(domain) ?? domain;
      const color = suggestColor(name, 0, envs.map((e) => e.color));
      return [...envs, { id: newId(), name, domain, color }];
    }, []),
  }));
}

export async function migrateLegacyRules() {
  const data = await chrome.storage.sync.get([STORAGE_KEY, LEGACY_KEY]);
  if (!data[LEGACY_KEY]) return;
  if (!data[STORAGE_KEY]) {
    const projects = rulesToProjects(data[LEGACY_KEY]);
    if (projects.length) await saveProjects(projects);
  }
  await chrome.storage.sync.remove(LEGACY_KEY);
}
