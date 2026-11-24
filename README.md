# Dev Toolbox

A Chrome extension (Manifest V3) with context-menu shortcuts for everyday dev work.

## Features

### Environment switcher
Group the domains one app runs on into a **project** — e.g. *Prod* `test.com`, *QA* `test-qa.com`,
*Local* `localhost:3000` — and jump between them while keeping the path, query and hash:
`test.com/dashboard/2` → `test-qa.com/dashboard/2`.

- **Right-click** any page of a project → **Dev Toolbox** → *Open in QA*. It opens in a new tab,
  grouped with the current one (named after the project, coloured like the target environment).
  Toggle ↗ on an environment in **Settings** to make its item switch the current tab instead, and
  turn off *Group new tabs* to skip grouping.
- **Toolbar icon** shows the current environment and the others to switch to.
  Click to open here, ⌘/Ctrl-click or ↗ for a new (grouped) tab, or press `1`–`9`.
- **Settings** (toolbar icon → ⚙) to manage projects, environment names, colours and domains.
  Subdomains carry over (`app.test.com` → `app.test-qa.com`) and ports are supported.

### MSAL bearer token
Copy the access token the current app is already holding — handy when an Azure AD / Entra
token expires every hour and you need a fresh one for Postman or `curl`.

- **Toolbar icon** → **Copy bearer token** shows the token's scope and time-to-expiry, and
  copies the raw JWT on click.
- **Right-click** any page → **Dev Toolbox** → *Copy MSAL bearer token* (a ✓ badge confirms).

It reads MSAL.js's cache from the page's `localStorage`/`sessionStorage` on the active tab
(no host permissions), classifies each entry as an **access** or **ID** token (by MSAL's
`credentialType`, falling back to decoding the JWT), and copies the newest one that hasn't
expired. Plain-text cache entries are supported; `kmsi`-off encrypted entries in
msal-browser v4 are skipped.

Each project sets its own rule in **Settings** → *Copy token*:
- **Access token** (default) or **ID token**.
- An optional **scope/audience filter** — e.g. `api://my-api` — so apps that hold tokens for
  several APIs (Graph + your own) always copy the right one.

## Install
1. Open `chrome://extensions` and enable **Developer mode**.
2. Click **Load unpacked** and select this folder.
3. Pin **Dev Toolbox** from the extensions (puzzle) menu.

## Development
Popup and settings pages load fresh from disk each time they open, but the background service worker
(which builds the right-click menu) keeps running old code. After changing `background.js` or
`features/`, click **Reload** on the extension card in `chrome://extensions`.
