// Repair sessions written by dsh-skill-loader v0.1.x.
//
// Problem: v0.1 stored per-conversation skill selections as custom session
// events (`skill-loader/selection`) — an event type unknown to the harness.
// The persistence loader refuses to interpret a log containing an unknown
// event type unless the event carries the `ignorable: true` envelope marker,
// so every affected session failed with SessionFormatUnsupportedError after
// a dsh restart.
//
// What this does: rewrites every affected session.jsonl.zstd under
// $DSH_HOME/sessions, marking those events ignorable so the sessions load
// again. Originals are kept as `<name>.bak`. Run it with dsh STOPPED.
//
// Usage:
//   node scripts/repair-v01-logs.mjs            # DSH_HOME from env or ~/.dsh
//   node scripts/repair-v01-logs.mjs /path/to/.dsh
//
// The script imports `decodeStorageRecord`/`packChunkRuns` from the installed
// @deepseek-ai/dsh-session package. It finds that package automatically in
// the usual install locations; if yours is elsewhere, point DSH_SESSION_JS at
// its lib/index.js (a file:// URL or a Windows path).
import { readdir, readFile, writeFile, copyFile } from 'node:fs/promises'
import { existsSync as exists } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { pathToFileURL } from 'node:url'
import { zstdCompress, zstdDecompressSync, constants } from 'node:zlib'
import { promisify } from 'node:util'

const zstdCompressAsync = promisify(zstdCompress)
const CHECKSUM_OPTIONS = { params: { [constants.ZSTD_c_checksumFlag]: 1 } }
const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]) // Zstandard frame magic

const home = process.env.DSH_HOME ?? process.argv[2] ?? join(homedir(), '.dsh')
const sessionsRoot = join(home, 'sessions')

function moduleCandidates() {
  const list = []
  if (process.env.DSH_SESSION_JS !== undefined && process.env.DSH_SESSION_JS !== '') list.push(process.env.DSH_SESSION_JS)
  list.push(join(home, 'profiles', 'node_modules', '@deepseek-ai', 'dsh-session', 'lib', 'index.js'))
  list.push(join(process.env.APPDATA ?? '', 'npm', 'node_modules', '@deepseek-ai', 'dsh', 'node_modules', '@deepseek-ai', 'dsh-session', 'lib', 'index.js'))
  return list
}

const resolved = moduleCandidates().find((candidate) => exists(candidate))
if (resolved === undefined) {
  console.error('could not locate @deepseek-ai/dsh-session/lib/index.js — set DSH_SESSION_JS to its path (file:// URL or Windows path)')
  process.exit(2)
}
const { decodeStorageRecord, packChunkRuns } = await import(pathToFileURL(resolved).href)

function scanFrames(buffer) {
  const frames = []
  let start = -1
  for (let i = 0; i + MAGIC.length <= buffer.length; i += 1) {
    if (buffer[i] === MAGIC[0] && buffer[i + 1] === MAGIC[1] && buffer[i + 2] === MAGIC[2] && buffer[i + 3] === MAGIC[3]) {
      if (start !== -1) frames.push(buffer.subarray(start, i))
      start = i
    }
  }
  if (start !== -1) frames.push(buffer.subarray(start))
  return frames
}

function decodeText(buffer) {
  const parts = []
  for (const frame of scanFrames(buffer)) parts.push(zstdDecompressSync(frame).toString('utf8'))
  return parts.join('')
}

async function encodeText(text) {
  const cut = text.indexOf('\n') + 1
  const headerFrame = await zstdCompressAsync(Buffer.from(text.slice(0, cut), 'utf8'), CHECKSUM_OPTIONS)
  const bodyFrame = await zstdCompressAsync(Buffer.from(text.slice(cut), 'utf8'), CHECKSUM_OPTIONS)
  return Buffer.concat([headerFrame, bodyFrame])
}

async function collectLogs(root) {
  const out = []
  const walk = async (dir) => {
    let entries
    try { entries = await readdir(dir, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) await walk(path)
      else if (entry.isFile() && entry.name === 'session.jsonl.zstd') out.push(path)
    }
  }
  await walk(root)
  return out
}

if (!exists(sessionsRoot)) {
  console.error(`no sessions directory at ${sessionsRoot}`)
  process.exit(2)
}
const logs = await collectLogs(sessionsRoot)
console.log(`found ${logs.length} session logs under ${sessionsRoot}`)

let repaired = 0
for (const path of logs) {
  let buffer
  try { buffer = await readFile(path) } catch { continue }
  let text
  try { text = decodeText(buffer) } catch (error) {
    console.warn(`skip ${path}: decode failed (${error.message})`)
    continue
  }
  const cut = text.indexOf('\n') + 1
  const header = text.slice(0, cut)
  const body = text.slice(cut)
  const events = []
  for (const line of body.split('\n')) {
    if (line === '') continue
    let record
    try { record = JSON.parse(line) } catch { continue }
    for (const event of decodeStorageRecord(record)) events.push(event)
  }
  let changed = false
  for (const event of events) {
    if (event.type === 'skill-loader/selection' && event.ignorable !== true) {
      event.ignorable = true
      changed = true
    }
  }
  if (!changed) continue
  const nextBody = packChunkRuns(events).map((record) => JSON.stringify(record)).join('\n') + '\n'
  const next = await encodeText(header + nextBody)
  await copyFile(path, `${path}.bak`)
  await writeFile(path, next)
  repaired += 1
  console.log(`repaired: ${path} (${events.length} events, ${events.filter((e) => e.type === 'skill-loader/selection').length} selection events marked ignorable)`)
}
console.log(repaired === 0 ? 'nothing to repair' : `repaired ${repaired} log(s)`)
