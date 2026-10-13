import { applyRule, getRules, matchingRules, ruleLabel, switchDomain } from "../features/domain-switch.js";

const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
const rules = matchingRules(await getRules(), tab?.url ?? "");

document.getElementById("current").textContent = tab?.url ?? "";
document.getElementById("manage").addEventListener("click", () => chrome.runtime.openOptionsPage());
document.getElementById("empty").hidden = rules.length > 0;

const list = document.getElementById("rules");
for (const rule of rules) {
  const li = document.createElement("li");
  li.innerHTML = `
    <div class="label"></div>
    <div class="preview muted"></div>
    <div class="actions">
      <button class="primary" data-mode="here">Open here</button>
      <button data-mode="new">Open in new tab</button>
    </div>`;
  li.querySelector(".label").textContent = ruleLabel(rule);
  li.querySelector(".preview").textContent = applyRule(rule, tab.url);
  li.querySelectorAll("button").forEach((btn) =>
    btn.addEventListener("click", async () => {
      await switchDomain(tab, rule, { newTab: btn.dataset.mode === "new" });
      window.close();
    })
  );
  list.append(li);
}
