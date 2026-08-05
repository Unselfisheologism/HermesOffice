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

/** minimal bundle that passes verifyBundle (existence checks only) */
function makeMinimalBundle(appDir) {
  mkdirSync(join(appDir, 'Contents', 'Resources'), { recursive: true })
  mkdirSync(join(appDir, 'Contents', 'MacOS'), { recursive: true })
  writeFileSync(join(appDir, 'Contents', 'Info.plist'), '<?xml version="1.0"?>')
  writeFileSync(join(appDir, 'Contents', 'MacOS', 'HermesOffice'), '#!/bin/sh\n')
  writeFileSync(join(appDir, 'Contents', 'Resources', 'app.asar'), '')
  writeFileSync(
    join(appDir, 'Contents', 'Resources', 'build-info.json'),
    JSON.stringify({ commit: 'test-commit' }),
  )
}

test('install relaunch does not inherit ELECTRON_RUN_AS_NODE', () => {
  const temp = mkdtempSync(join(tmpdir(), 'hermesoffice-update-test-'))
  try {
    const bin = join(temp, 'bin')
    const stage = join(temp, 'stage')
    const stagedApp = join(stage, 'HermesOffice.app')
    const appPath = join(temp, 'Applications', 'HermesOffice.app')
    const capture = join(temp, 'open-env.txt')

    // staged (new) bundle + an already-installed (old) bundle that the atomic
    // swap renames aside before copying the new one in
    makeMinimalBundle(stagedApp)
    makeMinimalBundle(appPath)
    mkdirSync(bin, { recursive: true })
    executable(join(bin, 'pgrep'), 'exit 1')
    executable(join(bin, 'sleep'), 'exit 0')
    executable(join(bin, 'codesign'), 'exit 0')
    executable(join(bin, 'open'), `printf '%s' "\${ELECTRON_RUN_AS_NODE-unset}" > "${capture}"`)

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

test('check reports semantic versions (current + latest ho-v tag)', () => {
  const temp = mkdtempSync(join(tmpdir(), 'hermesoffice-update-test-'))
  try {
    const bin = join(temp, 'bin')
    const appPath = join(temp, 'Applications', 'HermesOffice.app')
    mkdirSync(bin, { recursive: true })
    makeMinimalBundle(appPath)
    writeFileSync(
      join(appPath, 'Contents', 'Resources', 'build-info.json'),
      JSON.stringify({ commit: 'test-commit', version: '0.4.0' }),
    )
    executable(
      join(bin, 'git'),
      `if [ "$1" = "ls-remote" ]; then
  if echo "$*" | grep -q "refs/heads/main"; then
    printf '%s\trefs/heads/main\n' 4444444444444444444444444444444444444444
  else
    printf '%s\trefs/tags/ho-v0.4.0\n' 1111111111111111111111111111111111111111
    printf '%s\trefs/tags/ho-v0.5.0\n' 2222222222222222222222222222222222222222
    printf '%s\trefs/tags/ho-v0.5.0^{}\n' 2222222222222222222222222222222222222222
    printf '%s\trefs/tags/v0.5.83\n' 3333333333333333333333333333333333333333
  fi
  exit 0
fi
exit 1`,
    )
    const result = spawnSync(process.execPath, [HELPER, 'check'], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${bin}:/usr/bin:/bin`,
        HERMESOFFICE_APP_PATH: appPath,
        HERMESOFFICE_REPO: 'https://example.invalid/repo.git',
      },
    })
    assert.equal(result.status, 0, result.stderr || result.stdout)
    const out = JSON.parse(result.stdout)
    assert.equal(out.currentVersion, '0.4.0')
    assert.equal(out.latestVersion, '0.5.0')
    assert.equal(out.latestCommit, '2222222222222222222222222222222222222222')
    assert.equal(out.main, '4444444444444444444444444444444444444444')
    assert.equal(out.behind, true)
  } finally {
    rmSync(temp, { recursive: true, force: true })
  }
})

test('prepare resolves npm outside the minimal PATH (fake sh reports it)', () => {
  const temp = mkdtempSync(join(tmpdir(), 'hermesoffice-update-test-'))
  try {
    const bin = join(temp, 'bin')
    const src = join(temp, 'src')
    const marker = join(temp, 'npm-called.txt')
    mkdirSync(bin, { recursive: true })
    mkdirSync(join(src, '.git'), { recursive: true })
    // fake sh: `command -v npm` prints the fake npm (a login shell would do
    // the same on a real machine); real npm is deliberately NOT on this PATH
    executable(join(bin, 'sh'), `printf '%s\n' "${bin}/npm"`)
    executable(join(bin, 'npm'), `printf 'called' > "${marker}"`)
    executable(join(bin, 'git'), 'exit 0')
    const result = spawnSync(process.execPath, [HELPER, 'prepare'], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${bin}:/usr/bin:/bin`,
        HERMESOFFICE_SOURCE_DIR: src,
      },
    })
    assert.equal(result.status, 0, result.stderr || result.stdout)
    assert.equal(readFileSync(marker, 'utf8'), 'called')
  } finally {
    rmSync(temp, { recursive: true, force: true })
  }
})

test('install does not wait out the poll window on its own process (pgrep self-match)', () => {
  // Regression: the helper runs through the packaged HermesOffice binary
  // (ELECTRON_RUN_AS_NODE), so `pgrep -x HermesOffice` matches the helper
  // itself. Before the fix the wait loop always burned the full 30s poll —
  // and, worse, masked whether the real app had actually quit before the
  // bundle swap. The fake pgrep reports the helper's own parent PID; with the
  // self-filter the install must proceed immediately (well under 30s).
  const temp = mkdtempSync(join(tmpdir(), 'hermesoffice-update-test-'))
  try {
    const bin = join(temp, 'bin')
    const stage = join(temp, 'stage')
    const stagedApp = join(stage, 'HermesOffice.app')
    const appPath = join(temp, 'Applications', 'HermesOffice.app')

    makeMinimalBundle(stagedApp)
    makeMinimalBundle(appPath)
    mkdirSync(bin, { recursive: true })
    // report the helper's PID ($$ is the pgrep shell; its parent is the helper)
    executable(join(bin, 'pgrep'), 'ps -o ppid= -p $$')
    executable(join(bin, 'sleep'), 'exit 0')
    executable(join(bin, 'codesign'), 'exit 0')
    executable(join(bin, 'open'), 'exit 0')

    const start = Date.now()
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
    const elapsed = Date.now() - start

    assert.equal(result.status, 0, result.stderr || result.stdout)
    assert.ok(elapsed < 10_000, `install took ${elapsed}ms — poll window not skipped`)
  } finally {
    rmSync(temp, { recursive: true, force: true })
  }
})
