import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const appState = { isPackaged: true }
const appOn = vi.fn()

vi.mock('electron', () => ({
  app: {
    get isPackaged() {
      return appState.isPackaged
    },
    on: (...args: unknown[]) => appOn(...args),
    dock: undefined,
  },
  Notification: {
    isSupported: () => false,
  },
}))

const existsSync = vi.fn(() => false)
const readFileSync = vi.fn()

vi.mock('node:fs', () => ({
  existsSync: (...args: unknown[]) => existsSync(...args),
  readFileSync: (...args: unknown[]) => readFileSync(...args),
}))

const spawn = vi.fn()

vi.mock('node:child_process', () => ({
  spawn: (...args: unknown[]) => spawn(...args),
}))

async function loadMainUpdater() {
  return import('../src/main/main-updater')
}

beforeEach(() => {
  vi.resetModules()
  vi.useFakeTimers()
  appState.isPackaged = true
  appOn.mockClear()
  existsSync.mockReset()
  existsSync.mockReturnValue(false)
  readFileSync.mockReset()
  spawn.mockReset()
  delete process.env.HERMESOFFICE_ENABLE_SOURCE_UPDATE
})

afterEach(() => {
  vi.useRealTimers()
  delete process.env.HERMESOFFICE_ENABLE_SOURCE_UPDATE
})

describe('initMainUpdater safety gate', () => {
  it('does not schedule GitHub/source update checks unless explicitly enabled', async () => {
    const { initMainUpdater } = await loadMainUpdater()
    initMainUpdater(() => null)

    expect(vi.getTimerCount()).toBe(0)
    expect(appOn).not.toHaveBeenCalled()
    expect(existsSync).not.toHaveBeenCalled()
    expect(spawn).not.toHaveBeenCalled()
  })

  it('stays idle when a CDN app-update.yml feed is present even if source updates are enabled', async () => {
    process.env.HERMESOFFICE_ENABLE_SOURCE_UPDATE = '1'
    existsSync.mockImplementation((path) => String(path).endsWith('app-update.yml'))

    const { initMainUpdater } = await loadMainUpdater()
    initMainUpdater(() => null)

    expect(vi.getTimerCount()).toBe(0)
    expect(appOn).not.toHaveBeenCalled()
    expect(spawn).not.toHaveBeenCalled()
  })
})
