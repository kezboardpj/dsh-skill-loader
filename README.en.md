# dsh-skill-loader

English | [中文](README.md)

Per-conversation skill catalog picker for [DeepSeek Harness (dsh)](https://deepseek-harness.github.io/deepseek-harness/): on the new-conversation page, choose which skills get their catalog entries (name + description) **loaded into this conversation** (载入技能清单). Unselected skills are unavailable in that conversation.

## Features

- On a new conversation's start page, a "Skills" chip appears next to the workspace / agent-preset chips; it disappears once the conversation starts.
- Checked skills have their catalog entries loaded into the conversation: the skill catalog the model sees (`<available_skills>`) lists only the checked skills.
- Unchecked skills are **unavailable** in that conversation:
  - absent from the model's catalog;
  - `/name` gestures are refused (a "not loaded" notice is injected instead);
  - direct `skill` tool calls are denied via `tools/pre-execute`.
- Conversations with no stored selection keep dsh's default behavior (everything loaded).
- The selection is persisted in the dsh settings document (`skill-loader` namespace, `$DSH_HOME/settings.yaml`), so it survives refresh/restart.

> Placement note: the hero row on the start page is hardcoded JSX in the shipped UI and declares only two single-seat slots (both occupied by built-in pickers), so a plugin cannot declare a third seat there. This plugin therefore **appends its own chip node** to that row and renders it with react-dom (anchored via stable attributes: the `[data-phase="hero"]` root and the workspace chip's `button[aria-haspopup="menu"]` button, re-applied by a MutationObserver whenever React remounts the row). It only appears while the current session is blank.

## Commands

| Command | Description |
|---|---|
| `/skill-select <name1,name2,...>` | Set this conversation's skill catalog to these skills (comma-separated; no arguments clears it) |
| `/skill-unarchive <sessionId1,...>` | Unarchive the given conversations so they reappear in the sidebar (dsh's UI has no unarchive entry) |

## How it works

- Catalog takeover: a host `agent/pre-step` listener (registered after dsh-tool-skill, so it runs after its listeners) drops the unfiltered catalog dsh-tool-skill publishes and publishes its own filtered one (reusing the `skill-catalog` source kind and `source.entries` shape so dsh's own history/digest logic stays consistent and nothing republishes every turn).
- Interception: the `tools/pre-execute` waterfall denies `skill` calls for unselected skills; `/name` gesture injections are filtered by the selection.
- The selection is written to dsh settings (`$DSH_HOME/settings.yaml`) — never as a custom session-log event type, because this dsh build refuses to interpret logs containing unknown event types (`SessionFormatUnsupportedError`).

## Install

> `<profile>` is a placeholder: replace it with your profile name (the Web UI default is `web`; `dsh --profile <name>` starts a given profile).

From GitHub (recommended):

```sh
dsh plugin --profile web add https://github.com/kezboardpj/dsh-skill-loader.git
```

Or from a local directory:

```sh
dsh plugin --profile web add ./dsh-skill-loader
```

Restart that profile's dsh afterwards (installed plugins are not hot-reloaded).

(Note: `dsh plugin add` cannot handle paths containing spaces; for such paths, edit the profile's package.json dependency + `dsh.profile.bundles` directly, then run `pnpm install`.)

## Upgrading from 0.1

Fresh installs get 0.2.0 directly from the install command above. Existing 0.1 users should upgrade in this order (keep dsh stopped throughout):

1. Run the repair script so session logs written by 0.1 become readable again (originals are backed up as `.bak`; the script is idempotent and prints `nothing to repair` when nothing is affected. Users who never checked a skill in 0.1 — no `skill-loader/selection` events ever written — may skip this step; everyone else will keep failing to open old sessions after upgrading without it). **One command downloads and runs it** (no need to clone the repo first):

   Windows PowerShell:

   ```powershell
   Invoke-WebRequest "https://raw.githubusercontent.com/kezboardpj/dsh-skill-loader/main/scripts/repair-v01-logs.mjs" -OutFile "$env:TEMP\dsh-skill-loader-repair.mjs"; node "$env:TEMP\dsh-skill-loader-repair.mjs"
   ```

   macOS / Linux:

   ```sh
   curl -fsSL https://raw.githubusercontent.com/kezboardpj/dsh-skill-loader/main/scripts/repair-v01-logs.mjs -o /tmp/dsh-skill-loader-repair.mjs && node /tmp/dsh-skill-loader-repair.mjs
   ```

   (The script locates DSH_HOME and @deepseek-ai/dsh-session automatically; override with `DSH_HOME` / `DSH_SESSION_JS` on unusual setups.)

2. Update the plugin itself (git dependencies move to the latest commit and install the new dependencies):

   ```sh
   cd <your profile directory>
   pnpm update dsh-skill-loader
   ```

3. Restart dsh.

Note: users who installed 0.1 from a local directory (link install) must switch to the Git install (0.2's host half has dependencies that a bare linked checkout cannot resolve); selections made under 0.1 are no longer honored in repaired old sessions — those revert to the default "load everything" until re-selected.

## Changelog

### 0.2.0 (2026-08-15)

**Problem**: after checking skills and restarting dsh, reopening the conversation failed with `SessionFormatUnsupportedError` (history unavailable). v0.1 stored the selection as a custom session event (`skill-loader/selection`); dsh's log loader rejects unknown event types (and this build offers no registration surface for third-party event types), so the whole session log was refused.

**Fix**: the selection now lives in the dsh settings document (`skill-loader` namespace in `$DSH_HOME/settings.yaml`) and no custom log events are written; the host half gained `@deepseek-ai/dsh-settings` and `@deepseek-ai/schemastery` dependencies, and the Git install is recommended. Session logs affected by v0.1 can be repaired with [`scripts/repair-v01-logs.mjs`](scripts/repair-v01-logs.mjs) (run with dsh stopped; it marks the old events `ignorable` and backs up originals as `.bak`).

## License

[MIT](./LICENSE)
