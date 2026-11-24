import { copyFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

const cli = fileURLToPath(new URL('../dist/cli.js', import.meta.url))
const fixture = (name: string): string =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')

const created: string[] = []

function workspace(file: string): string {
  const directory = mkdtempSync(join(tmpdir(), 'chipbud-'))
  created.push(directory)
  copyFileSync(fileURLToPath(new URL(`./fixtures/${file}`, import.meta.url)), join(directory, file))
  return directory
}

function run(args: string[]) {
  return spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' })
}

afterEach(() => {
  for (const directory of created.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('cli', () => {
  it('reports without writing by default', () => {
    const directory = workspace('counter.vue')
    const result = run([directory, '--json'])

    expect(result.status).toBe(0)
    expect(JSON.parse(result.stdout).summary.converted).toBe(1)
    expect(readFileSync(join(directory, 'counter.vue'), 'utf8')).toBe(fixture('counter.vue'))
  })

  it('writes the converted file with --write', () => {
    const directory = workspace('counter.vue')
    const result = run([directory, '--write', '--json'])

    expect(result.status).toBe(0)
    expect(readFileSync(join(directory, 'counter.vue'), 'utf8')).toBe(fixture('counter.expected.vue'))
  })

  it('exits 1 and changes nothing when a file needs review', () => {
    const directory = workspace('mixin.vue')
    const result = run([directory, '--write', '--json'])

    expect(result.status).toBe(1)
    expect(JSON.parse(result.stdout).summary.needsReview).toBe(1)
    expect(readFileSync(join(directory, 'mixin.vue'), 'utf8')).toBe(fixture('mixin.vue'))
  })

  it('exits 2 without arguments', () => {
    expect(run([]).status).toBe(2)
  })

  it('converts Vuex spreads when a mapping file is given', () => {
    const directory = workspace('store-spread.vue')
    const config = fileURLToPath(new URL('../bench/vuex.config.json', import.meta.url))
    const result = run([directory, '--write', '--config', config, '--json'])

    expect(result.status).toBe(0)
    expect(readFileSync(join(directory, 'store-spread.vue'), 'utf8')).toBe(
      fixture('store-spread.expected.vue'),
    )
  })
})
