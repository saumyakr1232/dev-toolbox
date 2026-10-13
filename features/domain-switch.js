// Feature: switch the domain of a URL while keeping path, query and hash.
//
// A rule looks like { id, from, to, enabled }.
//   from: "test.com"      matches test.com and any subdomain (app.test.com)
//   to:   "test-qa.com"   replaces the matched part; may include a port ("localhost:3000")
//
// Example: https://app.test.com/dashboard/2?x=1  --(test.com → test-qa.com)-->
//          https://app.test-qa.com/dashboard/2?x=1

const STORAGE_KEY = "domainRules";

export const DEFAULT_RULES = [
  { id: "example-1", from: "test.com", to: "test-qa.com", enabled: true },
];

export async function getRules() {
  const data = await chrome.storage.sync.get(STORAGE_KEY);
  return data[STORAGE_KEY] ?? DEFAULT_RULES;
}

export async function saveRules(rules) {
  await chrome.storage.sync.set({ [STORAGE_KEY]: rules });
}

export function onRulesChanged(callback) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "sync" && changes[STORAGE_KEY]) callback(changes[STORAGE_KEY].newValue ?? []);
  });
}

// Normalise user input: strip scheme, path and trailing dots, lowercase.
export function cleanDomain(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/\.+$/, "");
}

function hostnameOf(domain) {
  return domain.replace(/:\d+$/, "");
}

export function ruleMatches(rule, url) {
  if (!rule.enabled || !rule.from || !rule.to) return false;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (!/^https?:$/.test(parsed.protocol)) return false;

  const from = cleanDomain(rule.from);
  const fromHost = hostnameOf(from);
  const hasPort = from !== fromHost;
  // If the rule specifies a port, the port must match too.
  if (hasPort && parsed.host !== from && !parsed.host.endsWith("." + from)) return false;
  return parsed.hostname === fromHost || parsed.hostname.endsWith("." + fromHost);
}

export function applyRule(rule, url) {
  if (!ruleMatches(rule, url)) return null;
  const parsed = new URL(url);
  const from = cleanDomain(rule.from);
  const to = cleanDomain(rule.to);
  const fromHost = hostnameOf(from);
  const subdomain = parsed.hostname.slice(0, parsed.hostname.length - fromHost.length); // "app." or ""

  // Use the target's port if it has one; drop the source port if the rule named it;
  // otherwise keep the original port.
  const toHost = hostnameOf(to);
  const toPort = to.slice(toHost.length + 1);
  const port = toPort || (from !== fromHost ? "" : parsed.port);
  // Setting `host` without a port does not clear an existing one, so set both explicitly.
  parsed.hostname = subdomain + toHost;
  parsed.port = port;
  return parsed.toString();
}

export function matchingRules(rules, url) {
  return rules.filter((rule) => ruleMatches(rule, url));
}

// Chrome match patterns used to show only relevant menu items on a page.
// Match patterns ignore ports, so "localhost:3000" becomes "*://localhost/*".
export function urlPatternsFor(rule) {
  const host = hostnameOf(cleanDomain(rule.from));
  if (!host) return [];
  return [`*://${host}/*`, `*://*.${host}/*`];
}

export function ruleLabel(rule) {
  return `${cleanDomain(rule.from)} → ${cleanDomain(rule.to)}`;
}

export async function switchDomain(tab, rule, { newTab = false } = {}) {
  const target = applyRule(rule, tab.url);
  if (!target) return false;
  if (newTab) {
    await chrome.tabs.create({ url: target, index: tab.index + 1, openerTabId: tab.id, active: true });
  } else {
    await chrome.tabs.update(tab.id, { url: target });
  }
  return true;
}
