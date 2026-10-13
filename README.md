# Dev Toolbox

A Chrome extension (Manifest V3) with context-menu shortcuts for everyday dev work.

## Features

### Environment switcher
Group the domains one app runs on into a **project** — e.g. *Prod* `test.com`, *QA* `test-qa.com`,
*Local* `localhost:3000` — and jump between them while keeping the path, query and hash:
`test.com/dashboard/2` → `test-qa.com/dashboard/2`.

- **Right-click** any page of a project → **Dev Toolbox** → *Open in QA*, or *Open in new tab ▸ QA*.
- **Toolbar icon** shows the current environment and the others to switch to.
  Click to open here, ⌘/Ctrl-click or ↗ for a new tab, or press `1`–`9`.
- **Settings** (toolbar icon → ⚙) to manage projects, environment names, colours and domains.
  Subdomains carry over (`app.test.com` → `app.test-qa.com`) and ports are supported.

## Install
1. Open `chrome://extensions` and enable **Developer mode**.
2. Click **Load unpacked** and select this folder.
3. Pin **Dev Toolbox** from the extensions (puzzle) menu.

## Development
Popup and settings pages load fresh from disk each time they open, but the background service worker
(which builds the right-click menu) keeps running old code. After changing `background.js` or
`features/`, click **Reload** on the extension card in `chrome://extensions`.
