import { findEnv, getProjects, openEnv, switchUrl, usableEnvs } from "../features/domain-switch.js";
import { icons } from "../lib/icons.js";

const $ = (id) => document.getElementById(id);

const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
const url = tab?.url ?? "";
const match = findEnv(await getProjects(), url);

$("settings").innerHTML = icons.settings;
$("settings").addEventListener("click", () => openSettings());

function openSettings(params = "") {
  if (params) chrome.tabs.create({ url: chrome.runtime.getURL("options/options.html") + params });
  else chrome.runtime.openOptionsPage();
  window.close();
}

if (match) renderSwitcher(match);
else renderEmpty();

function renderSwitcher({ project, env: current }) {
  $("project").textContent = project.name;
  const badge = $("current");
  badge.hidden = false;
  badge.dataset.color = current.color;
  badge.lastElementChild.textContent = current.name;

  const targets = usableEnvs(project).filter((env) => env.id !== current.id);
  if (targets.length === 0) {
    renderEmpty({
      title: "No other environments",
      text: `Add another environment to “${project.name}” to switch.`,
      action: "Open settings",
      onAction: () => openSettings(),
    });
    return;
  }

  $("switch").hidden = false;
  $("hint-icon").innerHTML = icons.external;
  if (!/Mac/i.test(navigator.platform)) $("hint-mod").textContent = "Ctrl";
  const go = async (env, newTab) => {
    await openEnv(tab, current, env, { newTab });
    window.close();
  };

  const rows = targets.map((env, i) => {
    const li = document.createElement("li");
    li.className = "env";
    li.tabIndex = 0;
    li.dataset.color = env.color;
    li.title = switchUrl(url, current.domain, env.domain);
    li.innerHTML = `
      <span class="dot"></span>
      <span class="text"><div class="name"></div><div class="domain"></div></span>
      ${i < 9 ? `<kbd>${i + 1}</kbd>` : ""}
      <button class="icon-btn" title="Open in new tab" aria-label="Open in new tab">${icons.external}</button>`;
    li.querySelector(".name").textContent = env.name;
    li.querySelector(".domain").textContent = env.domain;

    li.addEventListener("click", (e) => go(env, e.metaKey || e.ctrlKey));
    li.addEventListener("auxclick", (e) => e.button === 1 && go(env, true));
    li.addEventListener("keydown", (e) => e.key === "Enter" && go(env, e.metaKey || e.ctrlKey));
    li.querySelector("button").addEventListener("click", (e) => {
      e.stopPropagation();
      go(env, true);
    });
    return li;
  });
  $("envs").append(...rows);

  document.addEventListener("keydown", (e) => {
    const n = Number(e.key);
    if (n >= 1 && n <= Math.min(9, targets.length)) go(targets[n - 1], e.metaKey || e.ctrlKey);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const i = rows.indexOf(document.activeElement);
      const next = e.key === "ArrowDown" ? i + 1 : i - 1;
      rows[(next + rows.length) % rows.length].focus();
    }
  });
}

function renderEmpty(custom) {
  let host = "";
  try {
    const parsed = new URL(url);
    if (/^https?:$/.test(parsed.protocol)) host = parsed.host;
  } catch {}

  const content = custom ?? (host
    ? {
        title: "This site isn’t in a project",
        text: host,
        action: "Add this site",
        onAction: () => openSettings(`?add=${encodeURIComponent(host)}`),
      }
    : { title: "Nothing to switch here", text: "Open a website to switch between its environments." });

  if (!custom) $("project").textContent = "Dev Toolbox";
  $("empty").hidden = false;
  $("empty-icon").innerHTML = icons.globe;
  $("empty-title").textContent = content.title;
  $("empty-text").textContent = content.text;
  if (content.action) {
    const btn = $("add-site");
    btn.hidden = false;
    btn.textContent = content.action;
    btn.addEventListener("click", content.onAction);
    btn.focus();
  }
}
