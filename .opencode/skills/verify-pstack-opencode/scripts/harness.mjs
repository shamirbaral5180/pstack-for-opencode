#!/usr/bin/env node
// Verification harness for the pstack-for-opencode plugin.
//
// Starts a private OpenCode server with isolated config, data, state, and cache
// directories, so a verification run never touches the user's real config,
// session database, or model sheet. Prints JSON and keeps its state in
// <repo>/.verify/state.json.
//
// Usage:
//   node .opencode/skills/verify-pstack-opencode/scripts/harness.mjs launch [--port N] [--exe PATH]
//   node .opencode/skills/verify-pstack-opencode/scripts/harness.mjs doctor
//   node .opencode/skills/verify-pstack-opencode/scripts/harness.mjs snapshot [--out DIR]
//   node .opencode/skills/verify-pstack-opencode/scripts/harness.mjs get /api/skill [--out FILE]
//   node .opencode/skills/verify-pstack-opencode/scripts/harness.mjs run-command setup-pstack
//   node .opencode/skills/verify-pstack-opencode/scripts/harness.mjs sheet
//   node .opencode/skills/verify-pstack-opencode/scripts/harness.mjs stop

import { execFileSync, spawn } from "node:child_process"
import { existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createServer } from "node:net"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const repo = resolve(here, "../../../..")
const stateDir = join(repo, ".verify")
const stateFile = join(stateDir, "state.json")
const SETUP_SKILL = "pstack-poteto-mode"

const fail = (message) => {
  console.error(`error: ${message}`)
  process.exit(1)
}

const args = process.argv.slice(2)
const command = args[0]
const flag = (name) => {
  const index = args.indexOf(`--${name}`)
  return index === -1 ? undefined : args[index + 1]
}

function findCli(explicit) {
  const candidates = [
    explicit,
    process.env.OPENCODE_CLI,
    join(process.env.LOCALAPPDATA ?? "", "Programs", "ai.opencode.desktop", "resources", "opencode-cli.exe"),
  ].filter(Boolean)
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }
  try {
    const found = execFileSync(process.platform === "win32" ? "where" : "which", ["opencode"], {
      encoding: "utf8",
    })
      .split(/\r?\n/)[0]
      .trim()
    if (found) return found
  } catch {}
  fail("OpenCode CLI not found. Set OPENCODE_CLI to the opencode executable.")
}

function freePort() {
  return new Promise((done, reject) => {
    const server = createServer()
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address()
      server.close(() => done(port))
    })
  })
}

function readState() {
  if (!existsSync(stateFile)) fail(`no run state at ${stateFile}; run launch first`)
  return JSON.parse(readFileSync(stateFile, "utf8"))
}

const auth = (state) => `Basic ${Buffer.from(`opencode:${state.password}`).toString("base64")}`

async function call(state, path, init = {}) {
  let response
  try {
    response = await fetch(`http://127.0.0.1:${state.port}${path}`, {
      ...init,
      headers: { authorization: auth(state), "content-type": "application/json", ...(init.headers ?? {}) },
    })
  } catch (error) {
    fail(`${init.method ?? "GET"} ${path} failed: ${error.message}`)
  }
  const text = await response.text()
  if (!response.ok) fail(`${init.method ?? "GET"} ${path} returned ${response.status}: ${text.slice(0, 400)}`)
  return text
}

const unwrap = (payload) => (Array.isArray(payload) ? payload : (payload.data ?? []))

function alive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function writeOut(content, target) {
  if (!target) {
    process.stdout.write(content.endsWith("\n") ? content : `${content}\n`)
    return
  }
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, content)
  console.log(target)
}

const pause = (ms) => new Promise((done) => setTimeout(done, ms))

async function launch() {
  if (existsSync(stateFile)) {
    const previous = JSON.parse(readFileSync(stateFile, "utf8"))
    if (alive(previous.pid)) fail(`a run is already live on port ${previous.port} (pid ${previous.pid}); run stop first`)
  }
  const cli = findCli(flag("exe"))
  const port = Number(flag("port") ?? (await freePort()))
  const scratch = join(tmpdir(), `pstack-verify-${Date.now()}`)
  const config = join(scratch, "config")
  mkdirSync(join(config, "opencode"), { recursive: true })
  writeFileSync(
    join(config, "opencode", "opencode.jsonc"),
    `${JSON.stringify({ $schema: "https://opencode.ai/config.json", plugins: [repo.replaceAll("\\", "/")] }, null, 2)}\n`,
  )

  const env = {
    ...process.env,
    XDG_CONFIG_HOME: config,
    XDG_DATA_HOME: join(scratch, "data"),
    XDG_STATE_HOME: join(scratch, "state"),
    XDG_CACHE_HOME: join(scratch, "cache"),
  }
  const logPath = join(scratch, "serve.log")
  const child = spawn(cli, ["serve", "--port", String(port), "--hostname", "127.0.0.1"], {
    cwd: repo,
    env,
    detached: true,
    stdio: ["ignore", openSync(logPath, "a"), openSync(logPath, "a")],
    windowsHide: true,
  })
  child.unref()

  const readLog = () => (existsSync(logPath) ? readFileSync(logPath, "utf8") : "")
  const deadline = Date.now() + 60_000
  let password
  while (Date.now() < deadline) {
    const match = /server password (\S+)/.exec(readLog())
    if (match) {
      password = match[1]
      break
    }
    if (child.exitCode !== null) fail(`server exited early: ${readLog().slice(0, 800)}`)
    await pause(250)
  }
  if (!password) {
    child.kill()
    fail(`server did not report a password within 60s: ${readLog().slice(0, 800)}`)
  }

  mkdirSync(stateDir, { recursive: true })
  const state = { cli, repo, port, pid: child.pid, password, scratch, startedAt: new Date().toISOString(), sessionID: undefined }
  writeFileSync(stateFile, `${JSON.stringify(state, null, 2)}\n`)

  // A location only boots its registry once it has a session, so prove the
  // plugin's registrations exist before calling the instance ready.
  const created = JSON.parse(await call(state, "/api/session", { method: "POST", body: JSON.stringify({ title: "pstack verification" }) }))
  state.sessionID = (created.data ?? created).id
  writeFileSync(stateFile, `${JSON.stringify(state, null, 2)}\n`)

  const skillDeadline = Date.now() + 30_000
  let skills = []
  while (Date.now() < skillDeadline) {
    skills = unwrap(JSON.parse(await call(state, "/api/skill")))
    if (skills.some((skill) => skill.id === SETUP_SKILL)) break
    await pause(250)
  }
  if (!skills.some((skill) => skill.id === SETUP_SKILL)) {
    fail(`plugin registered no ${SETUP_SKILL} skill; registry has ${skills.length} entries`)
  }

  console.log(JSON.stringify({ port, pid: child.pid, sessionID: state.sessionID, scratch, state: stateFile }, null, 2))
}

async function doctor() {
  const state = readState()
  const problems = []
  if (!alive(state.pid)) problems.push(`process ${state.pid} is not running`)
  if (!existsSync(state.scratch)) problems.push(`scratch directory ${state.scratch} is gone`)
  const configFile = join(state.scratch, "config", "opencode", "opencode.jsonc")
  if (!existsSync(configFile)) problems.push(`config ${configFile} is gone`)
  let info
  try {
    info = JSON.parse(await call(state, "/api/info"))
  } catch (error) {
    problems.push(String(error))
  }
  if (info && info.pid !== state.pid) problems.push(`port ${state.port} belongs to pid ${info.pid}, not ${state.pid}`)
  if (problems.length) fail(problems.join("; "))
  const skills = unwrap(JSON.parse(await call(state, "/api/skill")))
  if (!skills.some((skill) => skill.id === SETUP_SKILL)) fail("plugin skills are not registered on this instance")
  console.log(
    JSON.stringify(
      { ok: true, pid: state.pid, port: state.port, version: info.version, sessionID: state.sessionID, repo: state.repo, scratch: state.scratch },
      null,
      2,
    ),
  )
}

async function snapshot() {
  const state = readState()
  const out = flag("out") ?? join(stateDir, "artifacts", new Date().toISOString().replace(/[:.]/g, "-"))
  mkdirSync(out, { recursive: true })
  const bodies = {
    "info.json": await call(state, "/api/info"),
    "skills.json": await call(state, "/api/skill"),
    "commands.json": await call(state, "/api/command"),
    "agents.json": await call(state, "/api/agent"),
  }
  for (const [name, body] of Object.entries(bodies)) writeFileSync(join(out, name), body)
  console.log(
    JSON.stringify(
      {
        out,
        skills: unwrap(JSON.parse(bodies["skills.json"])).map((skill) => skill.id),
        commands: unwrap(JSON.parse(bodies["commands.json"])).map((command) => command.name),
        agents: unwrap(JSON.parse(bodies["agents.json"])).map((agent) => agent.id),
      },
      null,
      2,
    ),
  )
}

async function main() {
  if (command === "launch") return launch()
  if (command === "doctor") return doctor()
  if (command === "snapshot") return snapshot()
  if (command === "stop") {
    const state = readState()
    if (alive(state.pid)) process.kill(state.pid)
    rmSync(stateFile, { force: true })
    console.log(JSON.stringify({ stopped: state.pid, scratch: state.scratch }))
    return
  }
  if (command === "get") {
    const state = readState()
    const path = args[1] ?? fail("get needs a path, such as /api/skill")
    return writeOut(await call(state, path), flag("out"))
  }
  if (command === "run-command") {
    const state = readState()
    const name = args[1] ?? fail("run-command needs a command name")
    const body = await call(state, `/api/session/${state.sessionID}/command`, {
      method: "POST",
      body: JSON.stringify({ name, text: "" }),
    })
    return writeOut(body || "{}", flag("out"))
  }
  if (command === "sheet") {
    const state = readState()
    const sheet = join(state.scratch, "config", "opencode", "pstack-models.md")
    if (!existsSync(sheet)) fail(`no sheet at ${sheet}; run run-command setup-pstack first`)
    return writeOut(readFileSync(sheet, "utf8"), flag("out"))
  }
  fail(`unknown command ${command ?? "(none)"}`)
}

void main()
