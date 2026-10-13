import { applyRule, cleanDomain, getRules, ruleLabel, saveRules } from "../features/domain-switch.js";

const DOMAIN_RE = /^[a-z0-9-]+(\.[a-z0-9-]+)*(:\d{1,5})?$/;

const rulesEl = document.getElementById("rules");
const statusEl = document.getElementById("status");
const testInput = document.getElementById("test-url");
const testResults = document.getElementById("test-results");

let rules = await getRules();

function newId() {
  return crypto.randomUUID().slice(0, 8);
}

function isValid(value) {
  return DOMAIN_RE.test(cleanDomain(value));
}

let saveTimer;
function scheduleSave() {
  clearTimeout(saveTimer);
  statusEl.textContent = "";
  saveTimer = setTimeout(async () => {
    // Only persist complete, valid rules; half-typed rows stay on screen.
    const valid = rules.filter((r) => isValid(r.from) && isValid(r.to));
    await saveRules(valid.map((r) => ({ ...r, from: cleanDomain(r.from), to: cleanDomain(r.to) })));
    const skipped = rules.length - valid.length;
    statusEl.textContent = skipped ? `Saved (${skipped} incomplete rule${skipped > 1 ? "s" : ""} not saved)` : "Saved";
  }, 400);
  renderTest();
}

function render() {
  rulesEl.replaceChildren(...rules.map(renderRule));
  renderTest();
}

function renderRule(rule) {
  const row = document.createElement("div");
  row.className = "rule" + (rule.enabled ? "" : " disabled");
  row.innerHTML = `
    <input type="checkbox" title="Enabled" />
    <input type="text" name="from" placeholder="test.com" />
    <span class="arrow">→</span>
    <input type="text" name="to" placeholder="test-qa.com" />
    <span class="buttons">
      <button data-action="reverse" title="Add the opposite rule">⇄ Reverse</button>
      <button data-action="delete" class="danger" title="Delete rule">✕</button>
    </span>`;

  const checkbox = row.querySelector("input[type=checkbox]");
  checkbox.checked = rule.enabled;
  checkbox.addEventListener("change", () => {
    rule.enabled = checkbox.checked;
    row.classList.toggle("disabled", !rule.enabled);
    scheduleSave();
  });

  for (const field of ["from", "to"]) {
    const input = row.querySelector(`input[name=${field}]`);
    input.value = rule[field];
    input.classList.toggle("invalid", !!rule[field] && !isValid(rule[field]));
    input.addEventListener("input", () => {
      rule[field] = input.value;
      input.classList.toggle("invalid", !!input.value && !isValid(input.value));
      scheduleSave();
    });
  }

  row.querySelector("[data-action=delete]").addEventListener("click", () => {
    rules = rules.filter((r) => r !== rule);
    render();
    scheduleSave();
  });

  row.querySelector("[data-action=reverse]").addEventListener("click", () => {
    rules.push({ id: newId(), from: rule.to, to: rule.from, enabled: true });
    render();
    scheduleSave();
  });

  return row;
}

function renderTest() {
  const url = testInput.value.trim();
  testResults.replaceChildren();
  if (!url) return;
  const results = rules
    .map((rule) => ({ rule, target: isValid(rule.from) && isValid(rule.to) ? applyRule(rule, url) : null }))
    .filter((r) => r.target);
  if (results.length === 0) {
    testResults.innerHTML = "<li>No enabled rule matches this URL.</li>";
    return;
  }
  for (const { rule, target } of results) {
    const li = document.createElement("li");
    li.textContent = `${ruleLabel(rule)}:  ${target}`;
    testResults.append(li);
  }
}

document.getElementById("add").addEventListener("click", () => {
  rules.push({ id: newId(), from: "", to: "", enabled: true });
  render();
  rulesEl.lastElementChild.querySelector("input[name=from]").focus();
});
testInput.addEventListener("input", renderTest);

render();
