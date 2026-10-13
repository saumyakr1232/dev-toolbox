import {
  findEnv,
  getProjects,
  migrateLegacyRules,
  onProjectsChanged,
  openEnv,
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
  const item = (props) =>
    chrome.contextMenus.create({ parentId: ROOT, contexts: PAGE_CONTEXTS, ...props });
  const projectPatterns = project.envs.flatMap((env) => urlPatternsFor(env.domain));
  // Each "Open in X" is shown on the project's other environments, not on X itself.
  const patternsExcept = (target) =>
    project.envs.filter((env) => env !== target).flatMap((env) => urlPatternsFor(env.domain));

  for (const env of project.envs) {
    item({
      id: `env:${project.id}:${env.id}:here`,
      title: `Open in ${env.name}`,
      documentUrlPatterns: patternsExcept(env),
    });
  }

  item({ id: `sep:${project.id}`, type: "separator", documentUrlPatterns: projectPatterns });

  const newTabParent = `newtab:${project.id}`;
  item({ id: newTabParent, title: "Open in new tab", documentUrlPatterns: projectPatterns });
  for (const env of project.envs) {
    item({
      id: `env:${project.id}:${env.id}:new`,
      parentId: newTabParent,
      title: env.name,
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
  const [feature, projectId, envId, mode] = String(info.menuItemId).split(":");
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

  await openEnv({ ...tab, url }, current.env, target, { newTab: mode === "new" });
});

chrome.runtime.onInstalled.addListener(async () => {
  await migrateLegacyRules();
  rebuildMenus();
});
chrome.runtime.onStartup.addListener(rebuildMenus);
onProjectsChanged(rebuildMenus);
