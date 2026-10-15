import {
  COLORS,
  cleanDomain,
  findEnv,
  getProjects,
  getSettings,
  isValidDomain,
  newId,
  saveProjects,
  saveSettings,
  suggestColor,
  switchUrl,
} from "../features/domain-switch.js";
import { tokenRule } from "../features/msal-token.js";
import { icons } from "../lib/icons.js";

const $ = (id) => document.getElementById(id);
const projectsEl = $("projects");

// Working copy. Rows can be incomplete here; only complete ones are saved.
// `autoColor` marks envs whose colour should follow their name until picked by hand.
let projects = (await getProjects()).map((p) => ({
  ...p,
  token: tokenRule(p),
  envs: p.envs.map((e) => ({ ...e })),
}));
const rowRefs = new Map(); // env id -> { nameInput, domainInput, errorEl, wrap }
const countRefs = new Map(); // project id -> count element

// ---- Saving ---------------------------------------------------------------

const MISSING_NAME = "Give this environment a name.";

function errorFor(env) {
  const name = env.name.trim();
  const domain = cleanDomain(env.domain);
  if (!name && !domain) return null; // untouched new row
  if (!name) return MISSING_NAME;
  if (!domain) return "Add the domain it runs on.";
  if (!isValidDomain(domain)) return "Use a domain like test-qa.com or localhost:3000.";
  for (const p of projects) {
    for (const other of p.envs) {
      if (other === env) break;
      if (cleanDomain(other.domain) === domain) return `Already used by ${p.name || "another project"} · ${other.name || "an environment"}.`;
    }
    if (p.envs.includes(env)) break;
  }
  return null;
}

const isComplete = (env) => env.name.trim() && cleanDomain(env.domain) && !errorFor(env);

function toStored() {
  return projects.map((p) => ({
    id: p.id,
    name: p.name.trim() || "Untitled project",
    token: tokenRule(p),
    envs: p.envs
      .filter(isComplete)
      .map(({ id, name, domain, color }) => ({ id, name: name.trim(), domain: cleanDomain(domain), color })),
  }));
}

let saveTimer;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    await saveProjects(toStored());
    const pending = projects.flatMap((p) => p.envs).filter((e) => (e.name.trim() || e.domain.trim()) && !isComplete(e)).length;
    showToast(pending ? `Saved · ${pending} incomplete environment${pending > 1 ? "s" : ""} not saved yet` : "Saved");
  }, 450);
  renderTest();
}

function validateAll() {
  for (const p of projects) {
    const count = p.envs.filter(isComplete).length;
    const countEl = countRefs.get(p.id);
    if (countEl) countEl.textContent = `${count} environment${count === 1 ? "" : "s"}`;
    for (const env of p.envs) {
      const refs = rowRefs.get(env.id);
      if (!refs) continue;
      let error = errorFor(env);
      // Don't nag about a missing name while the user is about to type it.
      if (error === MISSING_NAME && document.activeElement === refs.nameInput) error = null;
      refs.errorEl.textContent = error ?? "";
      refs.nameInput.classList.toggle("invalid", !!error && !env.name.trim());
      refs.domainInput.classList.toggle("invalid", !!error && !!env.name.trim());
    }
  }
}

// Structural changes (add/remove/move) re-render; keep an undo snapshot for removals.
function mutate(fn, { undoLabel } = {}) {
  const snapshot = structuredClone(projects);
  fn();
  render();
  scheduleSave();
  if (undoLabel) {
    clearTimeout(saveTimer); // show the undo toast instead of "Saved"
    saveProjects(toStored());
    showToast(undoLabel, "Undo", () => {
      projects = snapshot;
      render();
      scheduleSave();
    });
  }
}

// ---- Rendering ------------------------------------------------------------

function render() {
  rowRefs.clear();
  countRefs.clear();
  projectsEl.replaceChildren(...projects.map(renderProject));
  if (projects.length === 0) {
    projectsEl.innerHTML = `<div class="empty-projects muted">No projects yet. Add one to start switching environments.</div>`;
  }
  validateAll();
  renderTest();
}

function renderProject(project) {
  if (!project.token) project.token = tokenRule(project);
  const card = document.createElement("div");
  card.className = "project";
  card.innerHTML = `
    <div class="project-head">
      <input type="text" class="title-input" placeholder="Project name" aria-label="Project name" />
      <span class="count muted"></span>
      <button class="icon-btn danger" title="Delete project" aria-label="Delete project">${icons.trash}</button>
    </div>
    <div class="envs">
      <div class="env-cols"><span></span><span>Name</span><span>Domain</span><span></span></div>
    </div>
    <div class="project-token">
      <span class="pt-icon">${icons.key}</span>
      <span class="pt-label">Copy token</span>
      <select class="pt-type" aria-label="Which token to copy">
        <option value="access">Access token</option>
        <option value="id">ID token</option>
      </select>
      <input type="text" class="pt-filter" aria-label="Token scope or audience filter"
             placeholder="scope or audience contains… (optional)" spellcheck="false" />
    </div>
    <div class="project-foot">
      <button class="ghost">${icons.plus} Add environment</button>
    </div>`;

  const title = card.querySelector(".title-input");
  title.value = project.name;
  title.addEventListener("input", () => {
    project.name = title.value;
    validateAll();
    scheduleSave();
  });

  countRefs.set(project.id, card.querySelector(".count"));

  const typeSel = card.querySelector(".pt-type");
  const filterInput = card.querySelector(".pt-filter");
  typeSel.value = project.token.type;
  filterInput.value = project.token.filter;
  typeSel.addEventListener("change", () => {
    project.token.type = typeSel.value;
    scheduleSave();
  });
  filterInput.addEventListener("input", () => {
    project.token.filter = filterInput.value;
    scheduleSave();
  });

  card.querySelector(".project-head .icon-btn").addEventListener("click", () =>
    mutate(() => (projects = projects.filter((p) => p !== project)), {
      undoLabel: `Deleted “${project.name || "Untitled project"}”`,
    })
  );

  const envsEl = card.querySelector(".envs");
  project.envs.forEach((env, i) => envsEl.append(renderEnv(project, env, i)));

  card.querySelector(".project-foot button").addEventListener("click", () => {
    const env = { id: newId(), name: "", domain: "", color: suggestColor("", 0, project.envs.map((e) => e.color)), autoColor: true };
    mutate(() => project.envs.push(env));
    rowRefs.get(env.id).nameInput.focus();
  });

  return card;
}

function renderEnv(project, env, index) {
  const wrap = document.createElement("div");
  wrap.className = "env";
  wrap.innerHTML = `
    <div class="env-row">
      <div class="swatch-wrap">
        <button class="swatch" title="Colour" aria-label="Colour" aria-haspopup="true"><span class="dot"></span></button>
      </div>
      <input type="text" class="name-input" placeholder="QA" aria-label="Environment name" />
      <input type="text" class="domain-input" placeholder="test-qa.com" aria-label="Domain" spellcheck="false" />
      <div class="env-actions">
        <button class="icon-btn" data-move="-1" title="Move up" aria-label="Move up">${icons.up}</button>
        <button class="icon-btn" data-move="1" title="Move down" aria-label="Move down">${icons.down}</button>
        <button class="icon-btn danger" data-delete title="Delete environment" aria-label="Delete environment">${icons.trash}</button>
      </div>
    </div>
    <div class="env-error"></div>`;

  const swatchWrap = wrap.querySelector(".swatch-wrap");
  const swatch = wrap.querySelector(".swatch");
  swatchWrap.dataset.color = env.color;
  swatch.addEventListener("click", (e) => {
    e.stopPropagation();
    openPicker(swatchWrap, env);
  });

  const nameInput = wrap.querySelector(".name-input");
  const domainInput = wrap.querySelector(".domain-input");
  nameInput.value = env.name;
  domainInput.value = env.domain;

  nameInput.addEventListener("input", () => {
    env.name = nameInput.value;
    if (env.autoColor) {
      env.color = suggestColor(env.name, 0, project.envs.filter((e) => e !== env).map((e) => e.color));
      swatchWrap.dataset.color = env.color;
    }
    validateAll();
    scheduleSave();
  });
  nameInput.addEventListener("blur", validateAll);
  nameInput.addEventListener("focus", validateAll);
  domainInput.addEventListener("input", () => {
    env.domain = domainInput.value;
    validateAll();
    scheduleSave();
  });
  // Tidy pasted URLs ("https://test.com/foo" → "test.com") once the user leaves the field.
  domainInput.addEventListener("blur", () => {
    const clean = cleanDomain(domainInput.value);
    if (clean !== domainInput.value) {
      domainInput.value = env.domain = clean;
      validateAll();
      scheduleSave();
    }
  });

  const [up, down] = wrap.querySelectorAll("[data-move]");
  up.disabled = index === 0;
  down.disabled = index === project.envs.length - 1;
  for (const btn of [up, down]) {
    btn.addEventListener("click", () =>
      mutate(() => {
        const to = index + Number(btn.dataset.move);
        project.envs.splice(to, 0, ...project.envs.splice(index, 1));
      })
    );
  }

  wrap.querySelector("[data-delete]").addEventListener("click", () =>
    mutate(() => project.envs.splice(index, 1), {
      undoLabel: `Deleted “${env.name || env.domain || "environment"}”`,
    })
  );

  rowRefs.set(env.id, { nameInput, domainInput, errorEl: wrap.querySelector(".env-error"), wrap });
  return wrap;
}

// ---- Colour picker --------------------------------------------------------

let openPickerEl = null;
function closePicker() {
  openPickerEl?.remove();
  openPickerEl = null;
}

function openPicker(swatchWrap, env) {
  const wasOpen = openPickerEl?.parentElement === swatchWrap;
  closePicker();
  if (wasOpen) return;

  const picker = document.createElement("div");
  picker.className = "picker";
  picker.setAttribute("role", "menu");
  for (const color of COLORS) {
    const btn = document.createElement("button");
    btn.dataset.color = color;
    btn.title = color[0].toUpperCase() + color.slice(1);
    btn.setAttribute("aria-pressed", String(env.color === color));
    btn.innerHTML = `<span class="dot"></span>`;
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      env.color = color;
      env.autoColor = false;
      swatchWrap.dataset.color = color;
      closePicker();
      scheduleSave();
    });
    picker.append(btn);
  }
  swatchWrap.append(picker);
  openPickerEl = picker;
  picker.querySelector('[aria-pressed="true"]')?.focus();
}

document.addEventListener("click", closePicker);
document.addEventListener("keydown", (e) => e.key === "Escape" && closePicker());

// ---- Switching settings -------------------------------------------------

const groupTabsInput = $("group-tabs");
groupTabsInput.checked = (await getSettings()).groupTabs;
groupTabsInput.addEventListener("change", async () => {
  await saveSettings({ ...(await getSettings()), groupTabs: groupTabsInput.checked });
  showToast("Saved");
});

// ---- Toast ----------------------------------------------------------------

let toastTimer;
function showToast(message, actionLabel, onAction) {
  const toast = $("toast");
  toast.innerHTML = `${actionLabel ? "" : icons.check}<span></span><button></button>`;
  toast.querySelector("span").textContent = message;
  const btn = toast.querySelector("button");
  if (actionLabel) {
    btn.textContent = actionLabel;
    btn.addEventListener("click", () => {
      toast.classList.remove("show");
      onAction();
    });
  }
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), actionLabel ? 6000 : 1800);
}

// ---- Try it ---------------------------------------------------------------

const testInput = $("test-url");
const testResults = $("test-results");

function renderTest() {
  const raw = testInput.value.trim();
  testResults.replaceChildren();
  if (!raw) return;
  const url = /^[a-z]+:\/\//i.test(raw) ? raw : `https://${raw}`;

  const card = document.createElement("div");
  card.className = "test-card";
  testResults.append(card);

  const match = findEnv(toStored(), url);
  if (!match) {
    card.innerHTML = `<span class="muted">No environment matches this URL.</span>`;
    return;
  }

  const head = document.createElement("div");
  head.className = "test-detected";
  head.innerHTML = `<span></span><span class="badge" data-color="${match.env.color}"><span class="dot"></span><span></span></span>`;
  head.firstElementChild.textContent = match.project.name;
  head.querySelector(".badge > span:last-child").textContent = match.env.name;
  card.append(head);

  const others = match.project.envs.filter((env) => env.id !== match.env.id);
  if (others.length === 0) {
    card.insertAdjacentHTML("beforeend", `<div class="muted">Add another environment to this project to switch.</div>`);
  }
  for (const env of others) {
    const row = document.createElement("div");
    row.className = "test-row";
    row.innerHTML = `<span class="badge" data-color="${env.color}"><span class="dot"></span><span></span></span><code></code>`;
    row.querySelector(".badge > span:last-child").textContent = env.name;
    row.querySelector("code").textContent = switchUrl(url, match.env.domain, env.domain);
    card.append(row);
  }
}

testInput.addEventListener("input", renderTest);

// ---- Init -----------------------------------------------------------------

$("add-project").innerHTML = `${icons.plus} New project`;
$("add-project").addEventListener("click", () => {
  const env = { id: newId(), name: "", domain: "", color: suggestColor("", 0), autoColor: true };
  mutate(() => projects.push({ id: newId(), name: "", envs: [env] }));
  projectsEl.lastElementChild.querySelector(".title-input").focus();
});

render();

// Popup "Add this site" opens settings with ?add=<host>.
const addHost = new URLSearchParams(location.search).get("add");
if (addHost) {
  history.replaceState(null, "", location.pathname);
  testInput.value = `https://${addHost}/`;
  const existing = findEnv(toStored(), `https://${addHost}/`);
  if (existing) {
    const refs = rowRefs.get(existing.env.id);
    refs.wrap.scrollIntoView({ block: "center" });
    refs.wrap.classList.add("flash");
  } else {
    const env = { id: newId(), name: "", domain: cleanDomain(addHost), color: suggestColor("", 0), autoColor: true };
    mutate(() => projects.push({ id: newId(), name: hostLabel(addHost), envs: [env] }));
    const refs = rowRefs.get(env.id);
    refs.wrap.scrollIntoView({ block: "center" });
    refs.nameInput.focus();
    validateAll(); // focus events don't fire while the window itself is unfocused
  }
  renderTest();
}

// "app.my-site.com:3000" → "My-site"
function hostLabel(host) {
  const parts = cleanDomain(host).replace(/:\d+$/, "").split(".");
  const base = parts.length > 1 ? parts[parts.length - 2] : parts[0];
  return base.charAt(0).toUpperCase() + base.slice(1);
}
