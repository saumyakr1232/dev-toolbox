import {
  findEnv,
  getProjects,
  getSettings,
  migrateLegacyRules,
  onProjectsChanged,
  openEnv,
  opensInNewTab,
  urlPatternsFor,
  usableEnvs,
} from "./features/domain-switch.js";
import { copyToTab, getMsalTokens, pickToken, tokenRule } from "./features/msal-token.js";

const PAGE_CONTEXTS = ["page", "frame", "selection", "link", "image", "editable"];
const ROOT = "root";

// Rebuilds are queued so overlapping storage changes can't create duplicate IDs.
let rebuildQueue = Promise.resolve();
function rebuildMenus() {
  rebuildQueue = rebuildQueue.then(buildMenus).catch((err) => console.error("Menu build failed", err));
  return rebuildQueue;
}

async function buildMenus() {
  await chrome.contextMenus.removeAll();
  const projects = (await getProjects())
    .map((project) => ({ ...project, envs: usableEnvs(project) }))
    .filter((project) => project.envs.length >= 2);

  // A single explicit root keeps everything under "Dev Toolbox" with the extension icon.
  // It shows on any http(s) page so the token action is always reachable; the
  // environment-switch items below gate themselves to the pages they apply to.
  chrome.contextMenus.create({
    id: ROOT,
    title: "Dev Toolbox",
    contexts: PAGE_CONTEXTS,
    documentUrlPatterns: ["http://*/*", "https://*/*"],
  });

  for (const project of projects) buildDomainSwitchMenu(project);

  if (projects.length) {
    chrome.contextMenus.create({
      id: "token:sep",
      parentId: ROOT,
      type: "separator",
      contexts: PAGE_CONTEXTS,
      documentUrlPatterns: ["http://*/*", "https://*/*"],
    });
  }
  chrome.contextMenus.create({
    id: "token:copy",
    parentId: ROOT,
    title: "Copy MSAL bearer token",
    contexts: PAGE_CONTEXTS,
    documentUrlPatterns: ["http://*/*", "https://*/*"],
  });
}

function buildDomainSwitchMenu(project) {
  // Each "Open in X" is shown on the project's other environments, not on X itself.
  const patternsExcept = (target) =>
    project.envs.filter((env) => env !== target).flatMap((env) => urlPatternsFor(env.domain));

  for (const env of project.envs) {
    chrome.contextMenus.create({
      id: `env:${project.id}:${env.id}`,
      parentId: ROOT,
      contexts: PAGE_CONTEXTS,
      title: `Open in ${env.name}`,
      documentUrlPatterns: patternsExcept(env),
    });
  }
}

// Flash the toolbar badge to confirm a context-menu action (no notifications permission).
let badgeTimer;
function flashBadge(text, color = "#16a34a") {
  chrome.action.setBadgeBackgroundColor({ color });
  chrome.action.setBadgeText({ text });
  clearTimeout(badgeTimer);
  badgeTimer = setTimeout(() => chrome.action.setBadgeText({ text: "" }), 2000);
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const [feature, projectId, envId] = String(info.menuItemId).split(":");
  if (!tab) return;

  if (feature === "token") {
    const url = tab.url || info.pageUrl || "";
    const rule = tokenRule(findEnv(await getProjects(), url)?.project);
    const picked = pickToken(await getMsalTokens(tab.id), rule);
    if (!picked) return flashBadge("none", "#6b7280");
    const ok = await copyToTab(tab.id, picked.secret);
    return flashBadge(ok ? "✓" : "err", ok ? "#16a34a" : "#dc2626");
  }

  if (feature !== "env") return;

  const project = (await getProjects()).find((p) => p.id === projectId);
  const target = project?.envs.find((env) => env.id === envId);
  // Use the top-level page URL even when the click happened inside an iframe.
  const url = tab.url || info.pageUrl;
  const current = project && findEnv([project], url);
  if (!target || !current) return;

  // Each environment chooses new tab (the default) or in place; new tabs are grouped
  // with the current one unless grouping is turned off in settings.
  const newTab = opensInNewTab(target);
  const { groupTabs } = await getSettings();
  await openEnv({ ...tab, url }, current.env, target, {
    newTab,
    group: newTab && groupTabs ? { title: project.name, color: target.color } : null,
  });
});

chrome.runtime.onInstalled.addListener(async () => {
  await migrateLegacyRules();
  rebuildMenus();
});
chrome.runtime.onStartup.addListener(rebuildMenus);
onProjectsChanged(rebuildMenus);
