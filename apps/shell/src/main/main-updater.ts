import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { app, Notification } from 'electron'
import type { BrowserWindow } from 'electron'
import type { UpdateUiState } from '../shared/update-api'
import { closeUpdateWindow, pushUpdateState, showUpdateWindow } from './update-window'
import { initialState } from './updater'

/**
 * GitHub-main updater — the Hermes Office counterpart of the Hermes Desktop
 * updater (apps/desktop/electron/main.ts checkUpdates/applyUpdates).
 *
 * The Hermes Desktop checks how far the local checkout is behind origin/main
 * and applies by running `hermes update` (git pull) + rebuild + bundle swap.
 * HermesOffice does the same without a shipped feed: the app compares the
 * commit it was built from (build-info.json, baked at build time) against the
 * head of origin/main via `git ls-remote` (git protocol — no API token, no
 * rate limit), and applies by handing off to tools/hermesoffice-update.mjs,
 * which clones/fetches main, rebuilds (dist:mac), swaps /Applications and
 * relaunches. Full-package policy, same as the CDN updater.
 *
 * Runs ONLY when no app-update.yml is present (i.e. builds without
 * HERMESOFFICE_UPDATE_URL — the fork's normal state). When a CDN feed is
 * baked in, the electron-updater path in updater.ts owns updates and this
 * module stays silent, so the two never race.
 */

const REPO_URL = 'https://github.com/criptogus/HermesOffice.git'
const FIRST_CHECK_DELAY_MS = 15_000
const RECHECK_INTERVAL_MS = 4 * 60 * 60 * 1000

let started = false
let dismissedCommit: string | null = null
let lastNotifiedCommit: string | null = null

function log(...args: unknown[]): void {
  console.log('[main-updater]', ...args)
}

/** source checkout the helper script lives in (override for dev builds) */
function sourceDir(): string {
  if (process.env.HERMESOFFICE_SOURCE_DIR) return process.env.HERMESOFFICE_SOURCE_DIR
  return join(homedir(), 'Library/Application Support/HermesOffice/update-src')
}

function helperScript(): string {
  return join(sourceDir(), 'tools', 'hermesoffice-update.mjs')
}

/** commit the installed app was built from, or null if unknown */
function builtCommit(): string | null {
  try {
    const p = join(process.resourcesPath, 'build-info.json')
    if (!existsSync(p)) return null
    const info = JSON.parse(readFileSync(p, 'utf8'))
    return typeof info.commit === 'string' && info.commit ? info.commit : null
  } catch {
    return null
  }
}

/** head of origin/main via the git protocol — no API token, no rate limit */
function fetchMainCommit(): Promise<string | null> {
  return new Promise((resolve) => {
    const child = spawn('git', ['ls-remote', REPO_URL, 'refs/heads/main'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let out = ''
    child.stdout.on('data', (d: Buffer) => (out += d.toString()))
    child.on('error', (err) => {
      log('git ls-remote spawn error:', err.message)
      resolve(null)
    })
    child.on('close', (code) => {
      if (code !== 0) {
        log('git ls-remote failed with', code)
        resolve(null)
        return
      }
      const sha = out.trim().split(/\s+/)[0]
      resolve(sha || null)
    })
  })
}

function spawnHelper(
  args: string[],
  onProgress: (pct: number, stage: string | null) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [helperScript(), ...args], {
      env: {
        ...process.env,
        // packaged Electron: execPath is the HermesOffice binary — this flag
        // makes it run the helper as a plain Node process (no GUI, no lock)
        ELECTRON_RUN_AS_NODE: '1',
        HERMESOFFICE_SOURCE_DIR: sourceDir(),
        HERMESOFFICE_REPO: REPO_URL,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let buf = ''
    const onLine = (line: string): void => {
      const progress = /^PROGRESS (\d+)$/.exec(line)
      if (progress) {
        onProgress(Number(progress[1]), null)
        return
      }
      const stage = /^STAGE (.+)$/.exec(line)
      if (stage) onProgress(Number((buf.match(/PROGRESS (\d+)/) ?? [0, 0])[1]), stage[1])
    }
    const read = (d: Buffer): void => {
      buf += d.toString()
      const lines = buf.split('\n')
      buf = lines.pop() ?? ''
      for (const line of lines) {
        const t = line.trim()
        if (t) onLine(t)
      }
    }
    child.stdout.on('data', read)
    child.stderr.on('data', (d: Buffer) => log('helper stderr:', d.toString().trim()))
    child.on('error', reject)
    child.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`helper ${args[0]} failed (${code})`)),
    )
  })
}

async function ensureSource(): Promise<void> {
  if (existsSync(join(sourceDir(), '.git'))) return
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      'git',
      ['clone', '--filter=blob:none', '--no-checkout', REPO_URL, sourceDir()],
      {
        stdio: ['ignore', 'ignore', 'pipe'],
      },
    )
    child.stderr.on('data', (d: Buffer) => log('clone:', d.toString().trim()))
    child.on('error', reject)
    child.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`git clone failed (${code})`)),
    )
  })
}

async function checkForUpdate(getWindow: () => BrowserWindow | null): Promise<void> {
  const built = builtCommit()
  if (!built) {
    log('no build-info.json in bundle — update check skipped')
    return
  }
  const main = await fetchMainCommit()
  if (!main) {
    log('could not reach origin/main — network offline?')
    return
  }
  if (main === built) {
    log('up to date (', built.slice(0, 7), ')')
    return
  }
  if (main === dismissedCommit) return
  log('update available:', built.slice(0, 7), '→', main.slice(0, 7))

  // Attention in background: dock badge + bounce + system notification,
  // once per update SHA (the modal window alone goes unnoticed when the
  // shell is not frontmost).
  if (main !== lastNotifiedCommit) {
    lastNotifiedCommit = main
    app.dock?.setBadge('1')
    app.dock?.bounce('informational')
    if (Notification.isSupported()) {
      new Notification({
        title: 'HermesOffice update available',
        body: `${built.slice(0, 7)} → ${main.slice(0, 7)}`,
      }).show()
    }
  }

  const actions = {
    onDownload: () => {
      app.dock?.setBadge('')
      void (async () => {
        pushUpdateState({ phase: 'downloading', percent: 0 })
        try {
          await ensureSource()
          await spawnHelper(['prepare'], (pct) =>
            pushUpdateState({ phase: 'downloading', percent: pct }),
          )
          await spawnHelper(['build'], (pct) =>
            pushUpdateState({ phase: 'downloading', percent: pct }),
          )
          pushUpdateState({ phase: 'downloaded', percent: 100 })
        } catch (err) {
          log('download/build failed:', (err as Error).message)
          pushUpdateState({ phase: 'error' })
        }
      })()
    },
    onInstall: () => {
      app.dock?.setBadge('')
      closeUpdateWindow()
      // detach: the helper waits for this process to exit, swaps the bundle
      // and relaunches via `open -n`
      const child = spawn(process.execPath, [helperScript(), 'install'], {
        env: {
          ...process.env,
          ELECTRON_RUN_AS_NODE: '1',
          HERMESOFFICE_SOURCE_DIR: sourceDir(),
          HERMESOFFICE_REPO: REPO_URL,
        },
        detached: true,
        stdio: 'ignore',
      })
      child.unref()
      setImmediate(() => app.quit())
    },
    onLater: () => {
      app.dock?.setBadge('')
      dismissedCommit = main
      closeUpdateWindow()
    },
  }

  showUpdateWindow(getWindow(), initialState(main.slice(0, 7)), actions)
}

export function initMainUpdater(getWindow: () => BrowserWindow | null): void {
  if (started) return
  started = true
  if (!app.isPackaged) return
  if (process.platform !== 'win32' && process.platform !== 'darwin') return
  // CDN feed baked in? electron-updater (updater.ts) owns updates.
  if (existsSync(join(process.resourcesPath, 'app-update.yml'))) {
    log('app-update.yml present — CDN updater active, main-updater idle')
    return
  }

  const check = (): void => {
    void checkForUpdate(getWindow)
  }
  setTimeout(check, FIRST_CHECK_DELAY_MS)
  setInterval(check, RECHECK_INTERVAL_MS)

  // Re-surface a pending update when the user comes back to the app — the
  // first check can fire while the shell is in the background, where a modal
  // window goes completely unnoticed. Rate-limited: the check is a git
  // ls-remote round-trip, no need for one per focus.
  let lastFocusCheck = 0
  app.on('browser-window-focus', () => {
    if (Date.now() - lastFocusCheck < 60_000) return
    lastFocusCheck = Date.now()
    check()
  })
}

/** for UpdateUiState typing parity with updater.ts */
export type { UpdateUiState }
