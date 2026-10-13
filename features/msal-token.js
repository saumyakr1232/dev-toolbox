// Feature: copy the MSAL bearer token the app on the current tab already holds,
// so it can be pasted into Postman or a curl header without logging in again.
//
// MSAL.js caches access tokens in the page's localStorage/sessionStorage as JSON
// entries whose key contains "accesstoken" and whose value has credentialType
// "AccessToken" and a "secret" field (the JWT). We read those straight from the
// tab and copy the newest one that hasn't expired.
//
// Reading uses chrome.scripting on the active tab, so the activeTab grant from a
// toolbar or context-menu click is enough — no host permissions, and the token
// never leaves the page except onto the clipboard.

// ---- Injected functions (run in the page; must be self-contained) ---------

// Collects raw MSAL access-token cache entries from both web stores.
function readMsalTokens() {
  const out = [];
  const scan = (store, area) => {
    for (let i = 0; i < store.length; i++) {
      const key = store.key(i);
      if (!key || !/accesstoken/i.test(key)) continue;
      let entry;
      try {
        entry = JSON.parse(store.getItem(key));
      } catch {
        continue; // encrypted or unrelated value
      }
      if (!entry || !/^AccessToken/.test(entry.credentialType) || !entry.secret) continue;
      out.push({
        area,
        secret: entry.secret,
        scopes: entry.target || "",
        tenant: entry.realm || "",
        clientId: entry.clientId || "",
        account: entry.homeAccountId || "",
        expiresOn: Number(entry.expiresOn) || 0, // epoch seconds
        cachedAt: Number(entry.cachedAt) || 0, // epoch seconds (ms in some versions)
      });
    }
  };
  try { scan(window.localStorage, "local"); } catch {}
  try { scan(window.sessionStorage, "session"); } catch {}
  return out;
}

// Puts `text` on the clipboard from inside the page (no clipboard permission needed).
function copyTextInPage(text) {
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.cssText = "position:fixed;top:0;left:0;opacity:0;pointer-events:none";
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try { ok = document.execCommand("copy"); } catch {}
  ta.remove();
  return ok;
}

// ---- Module API -----------------------------------------------------------

export async function getMsalTokens(tabId) {
  try {
    const [res] = await chrome.scripting.executeScript({ target: { tabId }, func: readMsalTokens });
    return res?.result ?? [];
  } catch {
    return []; // restricted page (chrome://, store, etc.)
  }
}

export async function copyToTab(tabId, text) {
  try {
    const [res] = await chrome.scripting.executeScript({ target: { tabId }, func: copyTextInPage, args: [text] });
    return res?.result === true;
  } catch {
    return false;
  }
}

// Normalise cachedAt to ms whether MSAL stored seconds or milliseconds.
function cachedMs(t) {
  const n = t.cachedAt || t.expiresOn;
  return n > 1e12 ? n : n * 1000;
}

// Newest token that is still valid; falls back to the newest expired one so the
// popup can still show something and say it's stale.
export function pickToken(tokens, now = Date.now()) {
  if (!tokens?.length) return null;
  const skew = 10_000;
  const byNewest = [...tokens].sort((a, b) => cachedMs(b) - cachedMs(a));
  const chosen = byNewest.find((t) => t.expiresOn * 1000 - skew > now) ?? byNewest[0];
  return { ...chosen, expired: chosen.expiresOn * 1000 <= now };
}
