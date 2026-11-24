#!/usr/bin/env node
/**
 * Measures chipbud against pinned commits of public Vue 2 codebases, so the numbers in
 * the README cannot drift away from the tool.
 *
 *   node bench/run.mjs             compare against bench/baseline.json
 *   node bench/run.mjs --update    record a new baseline
 *   node bench/run.mjs --markdown  print the table for the README
 *
 * The clones live in bench/.cache and are fetched at the exact SHA in corpora.json.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { migrateSource } from '../dist/index.js'

const here = dirname(fileURLToPath(import.meta.url))
const cache = join(here, '.cache')
const corpora = JSON.parse(readFileSync(join(here, 'corpora.json'), 'utf8'))
const { version } = JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf8'))

const argv = process.argv.slice(2)
const flags = new Set(argv.filter((arg) => arg.startsWith('--')))
const configFlag = argv.indexOf('--config')
const config = configFlag === -1 ? undefined : JSON.parse(readFileSync(argv[configFlag + 1], 'utf8'))
const baseline = join(here, config ? 'baseline.config.json' : 'baseline.json')
const IGNORED = new Set(['node_modules', '.git', 'dist', 'bower_components', 'coverage'])
const FIELDS = ['files', 'converted', 'needsReview', 'skipped', 'errors', 'declarations']

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}

/** `rev-parse HEAD` fails in a repository that has no commit yet, which is not an error here. */
function head(dir) {
  try {
    return git(dir, ['rev-parse', 'HEAD']).trim()
  } catch {
    return null
  }
}

function checkout(corpus) {
  const dir = join(cache, corpus.name)
  mkdirSync(dir, { recursive: true })

  if (!existsSync(join(dir, '.git'))) {
    git(dir, ['init', '-q'])
    git(dir, ['remote', 'add', 'origin', corpus.repo])
  }
  if (head(dir) !== corpus.sha) {
    git(dir, ['fetch', '-q', '--depth', '1', 'origin', corpus.sha])
    git(dir, ['checkout', '-q', 'FETCH_HEAD'])
  }
  return dir
}

function collect(dir) {
  const files = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (IGNORED.has(entry.name)) continue
      files.push(...collect(join(dir, entry.name)))
    } else if (entry.name.endsWith('.vue')) {
      files.push(join(dir, entry.name))
    }
  }
  return files
}

function measure(corpus) {
  const dir = checkout(corpus)
  const totals = {
    name: corpus.name,
    kind: corpus.kind,
    sha: corpus.sha,
    files: 0,
    converted: 0,
    needsReview: 0,
    skipped: 0,
    errors: 0,
    declarations: 0,
    diagnostics: {},
  }

  for (const file of collect(dir).sort()) {
    const result = migrateSource(readFileSync(file, 'utf8'), { filename: relative(dir, file), config })
    totals.files += 1
    totals.declarations += result.converted.length
    if (result.status === 'converted') totals.converted += 1
    else if (result.status === 'needs-review') totals.needsReview += 1
    else if (result.status === 'skipped') totals.skipped += 1
    else totals.errors += 1

    for (const diagnostic of result.diagnostics) {
      totals.diagnostics[diagnostic.code] = (totals.diagnostics[diagnostic.code] ?? 0) + 1
    }
  }

  const ordered = Object.fromEntries(
    Object.entries(totals.diagnostics).sort(([, a], [, b]) => b - a || 0),
  )
  return { ...totals, diagnostics: ordered }
}

function sum(results, field) {
  return results.reduce((total, result) => total + result[field], 0)
}

function table(results) {
  const header = '| corpus | kind | files | converted | needs review | skipped | tool errors | declarations |'
  const rule = '| --- | --- | --- | --- | --- | --- | --- | --- |'
  const rows = results.map(
    (r) =>
      `| \`${r.name}\` | ${r.kind} | ${r.files} | ${r.converted} | ${r.needsReview} | ${r.skipped} | ${r.errors} | ${r.declarations} |`,
  )
  const total = `| **total** | | **${sum(results, 'files')}** | **${sum(results, 'converted')}** | **${sum(results, 'needsReview')}** | **${sum(results, 'skipped')}** | **${sum(results, 'errors')}** | **${sum(results, 'declarations')}** |`
  return [header, rule, ...rows, total].join('\n')
}

const results = corpora.map(measure)

if (flags.has('--markdown')) {
  process.stdout.write(`${table(results)}\n`)
} else if (flags.has('--update')) {
  const next = { chipbud: version, measuredAt: new Date().toISOString().slice(0, 10), corpora: results }
  writeFileSync(baseline, `${JSON.stringify(next, null, 2)}\n`)
  process.stdout.write(`${table(results)}\n\nbaseline written to ${relative(here, baseline)} (chipbud ${version})\n`)
} else {
  if (!existsSync(baseline)) {
    process.stderr.write(`bench: no baseline yet, run \`node bench/run.mjs ${config ? '--config ' + argv[configFlag + 1] + ' ' : ''}--update\` first\n`)
    process.exit(2)
  }

  const pinned = JSON.parse(readFileSync(baseline, 'utf8'))
  const drift = []

  for (const measured of results) {
    const expected = pinned.corpora.find((corpus) => corpus.name === measured.name)
    if (!expected) {
      drift.push(`${measured.name}: not in the baseline`)
      continue
    }
    for (const field of FIELDS) {
      if (measured[field] !== expected[field]) {
        drift.push(`${measured.name}.${field}: ${expected[field]} -> ${measured[field]}`)
      }
    }
  }

  process.stdout.write(`${table(results)}\n\n`)
  if (drift.length === 0) {
    process.stdout.write(`matches ${relative(here, baseline)} (chipbud ${pinned.chipbud})\n`)
  } else {
    process.stdout.write(`drift against ${relative(here, baseline)} (chipbud ${pinned.chipbud}):\n`)
    for (const line of drift) process.stdout.write(`  ${line}\n`)
    process.exitCode = 1
  }
}
