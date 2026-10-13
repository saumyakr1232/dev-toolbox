import {
  getRules,
  onRulesChanged,
  ruleLabel,
  switchDomain,
  urlPatternsFor,
} from "./features/domain-switch.js";

const PAGE_CONTEXTS = ["page", "frame", "selection", "link", "image", "editable"];
const DOMAIN_PARENT = "domain";

// Rebuilds are queued so overlapping storage changes can't create duplicate IDs.
let rebuildQueue = Promise.resolve();
function rebuildMenus() {
  rebuildQueue = rebuildQueue.then(buildMenus).catch((err) => console.error("Menu build failed", err));
  return rebuildQueue;
}

async function buildMenus() {
  await chrome.contextMenus.removeAll();
  await buildDomainSwitchMenu();
  // Future features add their own build*Menu() here.
}

async function buildDomainSwitchMenu() {
  const rules = (await getRules()).filter((r) => r.enabled && r.from && r.to);
  if (rules.length === 0) return;

  // The parent only appears on pages where at least one rule applies.
  chrome.contextMenus.create({
    id: DOMAIN_PARENT,
    title: "Switch domain",
    contexts: PAGE_CONTEXTS,
    documentUrlPatterns: rules.flatMap(urlPatternsFor),
  });

  for (const rule of rules) {
    const common = {
      parentId: DOMAIN_PARENT,
      contexts: PAGE_CONTEXTS,
      documentUrlPatterns: urlPatternsFor(rule),
    };
    chrome.contextMenus.create({ ...common, id: `domain:${rule.id}:here`, title: ruleLabel(rule) });
    chrome.contextMenus.create({ ...common, id: `domain:${rule.id}:new`, title: `${ruleLabel(rule)}  (new tab)` });
  }
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const [feature, ruleId, mode] = String(info.menuItemId).split(":");
  if (feature !== "domain" || !tab) return;

  const rule = (await getRules()).find((r) => r.id === ruleId);
  if (!rule) return;
  // Use the top-level page URL even when the click happened inside an iframe.
  await switchDomain({ ...tab, url: tab.url || info.pageUrl }, rule, { newTab: mode === "new" });
});

chrome.runtime.onInstalled.addListener(rebuildMenus);
chrome.runtime.onStartup.addListener(rebuildMenus);
onRulesChanged(rebuildMenus);
