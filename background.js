import {
  findEnv,
  getProjects,
  migrateLegacyRules,
  onProjectsChanged,
  openEnv,
  urlPatternsFor,
  usableEnvs,
} from "./features/domain-switch.js";

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
  if (projects.length === 0) return;

  const allPatterns = projects.flatMap((p) => p.envs.flatMap((env) => urlPatternsFor(env.domain)));
  // A single explicit root keeps everything under "Dev Toolbox" with the extension icon,
  // and only appears on sites that belong to a project.
  chrome.contextMenus.create({
    id: ROOT,
    title: "Dev Toolbox",
    contexts: PAGE_CONTEXTS,
    documentUrlPatterns: allPatterns,
  });

  for (const project of projects) buildDomainSwitchMenu(project);
  // Future features add their own items under ROOT here.
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

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const [feature, projectId, envId, mode] = String(info.menuItemId).split(":");
  if (feature !== "env" || !tab) return;

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
