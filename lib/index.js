/**
 * dsh-skill-loader — host half.
 *
 * Per-conversation skill CATALOG loading (载入技能清单, not 使用): every new
 * conversation normally loads the full skill catalog (name + description) into
 * its context. This plugin lets the user choose, per conversation, WHICH skills
 * get their catalog entries loaded — unselected skills become unavailable in
 * that conversation (the model's catalog no longer lists them, `/name` gestures
 * are refused, and `skill` tool calls for them are denied).
 *
 * Selection storage: the dsh SETTINGS document (`$DSH_HOME/settings.yaml`)
 * under the `skill-loader` namespace (`selections[sessionId] = names[]`) —
 * NOT a custom session-log event type. dsh's persistence loader rejects log
 * events whose type is outside its generated known-event catalog unless they
 * carry the `ignorable` marker, and `Session.append` cannot set that marker,
 * so a custom durable event would make every affected session fail to load
 * after a restart (SessionFormatUnsupportedError). Settings are the
 * sanctioned durable store for this shape of per-session state.
 *
 * Mechanics:
 * - `/skill-select <csv>` writes `selections[sessionId]` through the settings
 *   service (serialized, deep-merged, persisted).
 * - An `agent/pre-step` listener (registered after @deepseek-ai/dsh-tool-skill,
 *   so it runs after its listeners in the waterfall) removes the unfiltered
 *   catalog message dsh-tool-skill publishes, publishes the filtered catalog
 *   instead, and drops `/name` gesture injections for unselected skills
 *   (replacing them with a notice).
 * - A `tools/pre-execute` listener denies `skill` tool calls for unselected
 *   names.
 * - Sessions with no stored selection keep dsh's default behavior untouched.
 */
import { randomUUID } from 'node:crypto'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import z from '@deepseek-ai/schemastery'

export const name = 'skill-loader'

export const inject = ['commands', 'skills', 'tools', 'settings']

const NS = settingsNamespace('skill-loader')
const SELECTIONS_SCHEMA = z.object({ selections: z.dict(z.array(z.string())) })
const CATALOG_KIND = 'skill-catalog' // same kind dsh-tool-skill uses; `source.selected` marks OUR messages
const CATALOG_MAX_DESCRIPTION = 500 // mirrors dsh-tool-skill's default

export function apply(ctx) {
  const scope = ctx.get('settings').register(NS, SELECTIONS_SCHEMA)

  const selectionOf = (agent) => {
    const names = scope.get()?.selections?.[agent.id]
    return Array.isArray(names) ? [...names] : null
  }

  ctx.commands.register({
    name: 'skill-select',
    description: 'Load the selected skill catalog (name + description) into this conversation; unselected skills are unavailable here',
    // Keep the transcript row compact: no raw args, short result text.
    recordInput: false,
    handler: (invocation) => handleSelect(ctx, scope, invocation),
  })

  // dsh's archive is one-way in the UI (no unarchive surface); this command
  // removes session ids from the registry's archive set through the registry
  // itself, so the change is durable and the sidebar updates live.
  ctx.commands.register({
    name: 'skill-unarchive',
    description: 'Restore archived conversations so they reappear in the sidebar',
    recordInput: false,
    handler: (invocation) => handleUnarchive(ctx, invocation),
  })

  // Deny model `skill` tool calls for unselected skills.
  ctx.on('tools/pre-execute', (exec, next) => {
    if (exec.name !== 'skill') return next()
    const agent = exec.agent
    if (agent === void 0) return next()
    const selection = selectionOf(agent)
    if (selection === null) return next()
    const name = exec.arguments?.name
    if (typeof name === 'string' && !selection.includes(name)) {
      return {
        kind: 'deny',
        reason: `skill "${name}" is not loaded in this conversation (it is not selected in the conversation's skill picker)`,
      }
    }
    return next()
  })

  // Filter the published catalog and the `/name` gesture injections.
  // Registration order (this bundle loads after dsh-base) makes this listener
  // run AFTER dsh-tool-skill's own pre-step listeners.
  ctx.on('agent/pre-step', async ({ agent, messages, signal }, next) => {
    const decision = await next()
    if (decision.kind === 'reject') return decision
    const selection = selectionOf(agent)
    if (selection === null) return decision // plugin untouched for this session
    signal.throwIfAborted()
    const kept = []
    const blocked = []
    let inFlightCatalog
    for (const message of decision.messages) {
      const source = message.source
      if (source != null && source.kind === 'skill-invocation') {
        // User `/name` gesture: keep only selected skills.
        if (typeof source.name === 'string' && selection.includes(source.name)) kept.push(message)
        else if (typeof source.name === 'string' && !blocked.includes(source.name)) blocked.push(source.name)
        continue
      }
      if (source != null && source.kind === CATALOG_KIND && source.selected === void 0 && Array.isArray(source.entries)) {
        // dsh-tool-skill's unfiltered catalog: drop it, we publish our own.
        inFlightCatalog = message
        continue
      }
      kept.push(message)
    }
    const result = [...kept]
    for (const name of blocked) result.push(blockedNotice(name))
    const prior = lastSelectedCatalog(agent)
    const entries = inFlightCatalog !== void 0 ? inFlightCatalog.source.entries : await currentCatalogEntries(ctx, agent, signal)
    // Incomplete discovery data: retry next step, mirroring dsh-tool-skill.
    if (entries === null) return { kind: 'enter', messages: result }
    // Sync check against what we WOULD publish (the filtered view), so an
    // in-flight unfiltered catalog from dsh-tool-skill does not trigger a
    // republish every step.
    const filtered = filterEntries(entries, selection)
    const inSync = prior !== void 0
      && entriesEqual(prior.data.source.entries, filtered)
      && selectedEqual(prior.data.source.selected, selection)
    if (!inSync) {
      result.push(catalogMessage(filtered, selection, prior !== void 0))
    }
    return { kind: 'enter', messages: result }
  })
}

// ---------------------------------------------------------------------------
// Catalog state reads (durable, in the session log as known event types).
// ---------------------------------------------------------------------------

/** Last still-visible catalog message THIS plugin published, or undefined. */
function lastSelectedCatalog(agent) {
  const visible = new Set(agent.session.surface.nodes)
  for (let index = agent.session.events.length - 1; index >= 0; index -= 1) {
    const event = agent.session.events[index]
    if (event.type !== 'user/message' || !visible.has(event.seq)) continue
    const source = event.data?.source
    if (source?.kind === CATALOG_KIND && Array.isArray(source.selected)) return event
  }
  return void 0
}

function selectedEqual(left, right) {
  if (left.length !== right.length) return false
  return left.every((name) => right.includes(name))
}

function entriesEqual(left, right) {
  if (left.length !== right.length) return false
  return left.every((entry, index) => entry.name === right[index].name && entry.description === right[index].description)
}

// ---------------------------------------------------------------------------
// Catalog construction (formats mirror dsh-tool-skill's model-facing prose).
// ---------------------------------------------------------------------------

function escapeText(value) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

/** Normalized, length-bounded description exactly as the catalog publishes it. */
function catalogDescription(value, maxLength) {
  const normalized = value.replaceAll(/\s+/g, ' ').trim()
  return normalized.length <= maxLength ? normalized : `${normalized.slice(0, maxLength - 3)}...`
}

function isModelInvocable(skill) {
  return skill.invocation.modelInvocable
}

function isUserInvocable(skill) {
  return skill.invocation.userInvocable
}

async function currentCatalogEntries(ctx, agent, signal) {
  const snapshot = await ctx.skills.snapshot({ cwd: agent.session.header.cwd, signal, scope: agent })
  if (!snapshot.complete) return null
  return snapshot.skills.filter(isModelInvocable).map((skill) => ({
    name: skill.name,
    description: catalogDescription(skill.description, CATALOG_MAX_DESCRIPTION),
  }))
}

function filterEntries(entries, selection) {
  return entries.filter((entry) => selection.includes(entry.name))
}

function renderCatalogEntries(entries) {
  return entries.map((entry) => `- \`${entry.name}\`: ${escapeText(entry.description)}`)
}

function catalogMessage(entries, selection, update) {
  return createUserMessage({
    content: [{
      type: 'text',
      text: [
        '<system-reminder>',
        update
          ? 'The available skill catalog changed. This complete catalog replaces every earlier available-skills list in this session:'
          : 'A skill is a reusable set of task-specific instructions. The following skills are available in this session:',
        '',
        '<available_skills>',
        ...renderCatalogEntries(entries),
        '</available_skills>',
        '',
        entries.length === 0
          ? 'No skills are currently loaded in this conversation. Do not use names from earlier skill catalogs.'
          : 'If the user names a skill, or the task clearly matches a skill\u2019s description, call the `skill` tool with the exact skill name before taking task actions. Load all applicable skills, then follow their full instructions. This catalog contains summaries only; do not infer or follow a skill\u2019s instructions until it has been loaded.',
        '</system-reminder>',
      ].join('\n'),
    }],
    source: {
      kind: CATALOG_KIND,
      form: 'catalog',
      entries,
      selected: [...selection],
      ...update ? { update: true } : {},
    },
  })
}

function blockedNotice(name) {
  return createUserMessage({
    content: [{
      type: 'text',
      text: [
        '<system-reminder>',
        `skill \`${name}\` is not loaded in this conversation (its catalog entry was not selected), so it cannot be used here. Select it in the conversation\u2019s skill picker, or run \`/skill-select\`, to load it.`,
        '</system-reminder>',
      ].join('\n'),
    }],
    source: { kind: 'plugin', plugin: 'dsh-skill-loader', form: 'notice' },
  })
}

function createUserMessage(input) {
  return {
    ...input,
    id: randomUUID(),
    role: 'user',
  }
}

// ---------------------------------------------------------------------------
// The /skill-select command.
// ---------------------------------------------------------------------------

function parseSelection(raw) {
  const seen = new Set()
  const names = []
  for (const part of raw.split(',')) {
    const name = part.trim()
    if (name === '' || seen.has(name)) continue
    seen.add(name)
    names.push(name)
  }
  return names
}

async function handleSelect(ctx, scope, invocation) {
  const { agent, rawInput, signal } = invocation
  const names = parseSelection(rawInput)
  const lookup = { cwd: agent.session.header.cwd, signal, scope: agent }
  const available = await ctx.skills.list(lookup)
  const byName = new Map(available.map((skill) => [skill.name, skill]))
  const rejected = []
  for (const name of names) {
    const skill = byName.get(name)
    if (skill === void 0 || !isUserInvocable(skill)) rejected.push(name)
  }
  if (rejected.length > 0) return {
    kind: 'error',
    text: `skill(s) not available for selection: ${rejected.join(', ')}`,
  }
  await scope.update({ selections: { [agent.id]: names } })
  if (names.length === 0) return {
    kind: 'success',
    text: 'skill catalog cleared — no skills loaded in this conversation',
  }
  return {
    kind: 'success',
    text: `skill catalog updated — ${names.length} skill(s) loaded`,
  }
}

async function handleUnarchive(ctx, invocation) {
  const ids = parseSelection(invocation.rawInput)
  if (ids.length === 0) return {
    kind: 'error',
    text: 'Usage: /skill-unarchive <sessionId1,sessionId2,...>',
  }
  let registry
  try { registry = ctx.get('workspaceRegistry') } catch { registry = undefined }
  if (registry === undefined || typeof registry.setState !== 'function' || typeof registry.requireState !== 'function') return {
    kind: 'error',
    text: 'the workspace registry is unavailable in this composition',
  }
  const wanted = new Set(ids)
  const state = registry.requireState()
  const kept = state.archivedSessionIds.filter((id) => !wanted.has(id))
  const restored = state.archivedSessionIds.length - kept.length
  if (restored === 0) return {
    kind: 'success',
    text: 'none of those sessions are archived',
  }
  await registry.setState({ ...state, archivedSessionIds: kept })
  return {
    kind: 'success',
    text: `restored ${restored} archived conversation(s) to the sidebar`,
  }
}
