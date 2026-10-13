// Feature: copy the MSAL bearer token the app on the current tab already holds,
// so it can be pasted into Postman or a curl header without logging in again.
//
// MSAL.js caches tokens in the page's localStorage/sessionStorage as JSON entries
// with a "secret" field holding the JWT. We read those from the active tab, split
// them into access vs. id tokens (by credentialType, falling back to decoding the
// JWT), and copy the one a project's rule asks for.
//
// Reading uses chrome.scripting on the active tab, so the activeTab grant from a
// toolbar or context-menu click is enough — no host permissions, and the token
// never leaves the page except onto the clipboard.

// ---- Injected functions (run in the page; must be self-contained) ---------

// Collects MSAL token cache entries from both web stores, classified by type.
function readMsalTokens() {
  const b64urlToStr = (s) => {
    try {
      s = s.replace(/-/g, "+").replace(/_/g, "/");
      s += "===".slice((s.length + 3) % 4);
      return decodeURIComponent(
        atob(s)
          .split("")
          .map((c) => "%" + c.charCodeAt(0).toString(16).padStart(2, "0"))
          .join("")
      );
    } catch {
      return "";
    }
  };
  const isJwt = (v) => typeof v === "string" && /^[\w-]+\.[\w-]+\.[\w-]*$/.test(v);
  const claimsOf = (jwt) => {
    try {
      return JSON.parse(b64urlToStr(jwt.split(".")[1])) || {};
    } catch {
      return {};
    }
  };

  const out = [];
  const scan = (store, area) => {
    for (let i = 0; i < store.length; i++) {
      let entry;
      try {
        entry = JSON.parse(store.getItem(store.key(i)));
      } catch {
        continue; // raw string, encrypted blob, or unrelated value
      }
      if (!entry || typeof entry !== "object" || !isJwt(entry.secret)) continue;

      const ct = String(entry.credentialType || "");
      const claims = claimsOf(entry.secret);
      // credentialType is authoritative for MSAL; the JWT claims are a fallback
      // for non-standard caches (access tokens carry scp/roles, id tokens a nonce).
      const type = /^IdToken$/i.test(ct)
        ? "id"
        : /^AccessToken/i.test(ct)
        ? "access"
        : claims.scp || claims.roles
        ? "access"
        : claims.nonce
        ? "id"
        : "access";

      out.push({
        area,
        type,
        secret: entry.secret,
        scopes: String(entry.target || claims.scp || ""),
        aud: String(Array.isArray(claims.aud) ? claims.aud.join(" ") : claims.aud || ""),
        tenant: String(entry.realm || claims.tid || ""),
        clientId: String(entry.clientId || claims.appid || claims.azp || ""),
        expiresOn: Number(entry.expiresOn) || Number(claims.exp) || 0, // epoch seconds
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
    return []; // restricted page (chrome://, web store, etc.)
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

// A project's token-copy rule, with defaults for projects saved before the feature.
export function tokenRule(project) {
  const t = (project && project.token) || {};
  return {
    type: t.type === "id" ? "id" : "access",
    filter: typeof t.filter === "string" ? t.filter.trim() : "",
  };
}

// Normalise cachedAt to ms whether MSAL stored seconds or milliseconds.
function cachedMs(t) {
  const n = t.cachedAt || t.expiresOn;
  return n > 1e12 ? n : n * 1000;
}

// The token a rule selects: right type, matching the scope/audience filter if any,
// newest that's still valid (falling back to the newest expired one so the UI can
// show it and flag staleness). Returns null when nothing matches the rule.
export function pickToken(tokens, rule = {}, now = Date.now()) {
  if (!tokens?.length) return null;
  const type = rule.type === "id" ? "id" : "access";
  const filter = String(rule.filter || "").trim().toLowerCase();

  let pool = tokens.filter((t) => t.type === type);
  if (filter) pool = pool.filter((t) => `${t.scopes} ${t.aud}`.toLowerCase().includes(filter));
  if (!pool.length) return null;

  const skew = 10_000;
  const byNewest = [...pool].sort((a, b) => cachedMs(b) - cachedMs(a));
  const chosen = byNewest.find((t) => t.expiresOn * 1000 - skew > now) ?? byNewest[0];
  return { ...chosen, expired: chosen.expiresOn * 1000 <= now };
}
