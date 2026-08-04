import test from 'node:test'
import assert from 'node:assert/strict'
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const TOOLS_DIR = dirname(fileURLToPath(import.meta.url))
const HELPER = join(TOOLS_DIR, 'hermesoffice-update.mjs')

function executable(path, body) {
  writeFileSync(path, `#!/bin/sh\n${body}\n`)
  chmodSync(path, 0o755)
}

test('install relaunch does not inherit ELECTRON_RUN_AS_NODE', () => {
  const temp = mkdtempSync(join(tmpdir(), 'hermesoffice-update-test-'))
  try {
    const bin = join(temp, 'bin')
    const stage = join(temp, 'stage')
    const stagedApp = join(stage, 'HermesOffice.app')
    const appPath = join(temp, 'Applications', 'HermesOffice.app')
    const capture = join(temp, 'open-env.txt')

    mkdirSync(join(stagedApp, 'Contents', 'Resources'), { recursive: true })
    writeFileSync(
      join(stagedApp, 'Contents', 'Resources', 'build-info.json'),
      JSON.stringify({ commit: 'test-commit' }),
    )
    mkdirSync(bin, { recursive: true })
    executable(join(bin, 'pgrep'), 'exit 1')
    executable(join(bin, 'codesign'), 'exit 0')
    executable(
      join(bin, 'open'),
      `printf '%s' "\${ELECTRON_RUN_AS_NODE-unset}" > "${capture}"`,
    )

    const result = spawnSync(process.execPath, [HELPER, 'install'], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${bin}:/usr/bin:/bin`,
        ELECTRON_RUN_AS_NODE: '1',
        HERMESOFFICE_STAGE_DIR: stage,
        HERMESOFFICE_APP_PATH: appPath,
      },
    })

    assert.equal(result.status, 0, result.stderr || result.stdout)
    assert.equal(readFileSync(capture, 'utf8'), 'unset')
  } finally {
    rmSync(temp, { recursive: true, force: true })
  }
})
