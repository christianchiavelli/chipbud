#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs'
import { readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { parseArgs } from 'node:util'
import { resolveGlobals, type ChipbudConfig } from './config.js'
import { migrateSource, type FileResult } from './index.js'
import { buildReport, renderMarkdown } from './report.js'

const IGNORED_DIRS = new Set(['node_modules', 'dist', '.git', '.nuxt', '.output', 'coverage'])
const DEFAULT_CONFIG = 'chipbud.config.json'

const HELP = `chipbud: convert Vue options objects to <script setup>, or explain why not

Usage
  chipbud <path...> [--write] [--json] [--config <file>]

Options
  --write           apply the conversion to files that convert with zero diagnostics
  --json            print the report as JSON
  --config <file>   mapping file; defaults to ${DEFAULT_CONFIG} when present
  -h, --help
  -v, --version

Exit codes
  0  every file converted or was skipped
  1  at least one file needs review or failed
  2  usage error
`

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    allowPositionals: true,
    options: {
      write: { type: 'boolean', default: false },
      json: { type: 'boolean', default: false },
      config: { type: 'string' },
      help: { type: 'boolean', short: 'h', default: false },
      version: { type: 'boolean', short: 'v', default: false },
    },
  })

  if (values.help) {
    process.stdout.write(HELP)
    return
  }

  if (values.version) {
    process.stdout.write(`${await readVersion()}\n`)
    return
  }

  if (positionals.length === 0) {
    process.stderr.write(HELP)
    process.exitCode = 2
    return
  }

  const config = loadConfig(values.config)
  if (config === null) return

  const targets = await Promise.all(positionals.map(collectVueFiles))
  const files = targets.flat().sort()

  if (files.length === 0) {
    process.stderr.write('chipbud: no .vue files found in the given paths\n')
    process.exitCode = 2
    return
  }

  const results: FileResult[] = []
  let written = 0

  for (const file of files) {
    const path = relative(process.cwd(), file)

    let source: string
    try {
      source = await readFile(file, 'utf8')
    } catch (error) {
      results.push({
        path,
        status: 'error',
        converted: [],
        dropped: [],
        output: null,
        diagnostics: [
          {
            code: 'read-error',
            message: `Cannot read the file: ${error instanceof Error ? error.message : String(error)}`,
            line: 1,
            column: 1,
          },
        ],
      })
      continue
    }

    const migrated = migrateSource(source, { filename: path, config: config ?? undefined })
    if (values.write && migrated.status === 'converted' && migrated.output !== null) {
      await writeFile(file, migrated.output, 'utf8')
      written += 1
    }
    results.push(migrated)
  }

  const report = buildReport(results)
  process.stdout.write(values.json ? `${JSON.stringify(report, null, 2)}\n` : renderMarkdown(report))

  if (values.write && !values.json) {
    process.stdout.write(`\n${written} file(s) written\n`)
  }

  if (report.summary.needsReview > 0 || report.summary.errors > 0) process.exitCode = 1
}

async function collectVueFiles(target: string): Promise<string[]> {
  const info = await stat(target).catch(() => null)
  if (!info) {
    process.stderr.write(`chipbud: cannot read ${target}\n`)
    return []
  }
  if (info.isFile()) return target.endsWith('.vue') ? [target] : []
  if (!info.isDirectory()) return []

  const found: string[] = []
  for (const entry of await readdir(target, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) continue
      found.push(...(await collectVueFiles(join(target, entry.name))))
    } else if (entry.isFile() && entry.name.endsWith('.vue')) {
      found.push(join(target, entry.name))
    }
  }
  return found
}

async function readVersion(): Promise<string> {
  try {
    const raw = await readFile(new URL('../package.json', import.meta.url), 'utf8')
    return (JSON.parse(raw) as { version?: string }).version ?? '0.0.0'
  } catch {
    return '0.0.0'
  }
}

/** Returns undefined when there is no config, and null after reporting an invalid one. */
function loadConfig(explicit: string | undefined): ChipbudConfig | undefined | null {
  const path = explicit ?? (existsSync(DEFAULT_CONFIG) ? DEFAULT_CONFIG : undefined)
  if (path === undefined) return undefined

  try {
    const config = JSON.parse(readFileSync(path, 'utf8')) as ChipbudConfig
    resolveGlobals(config)
    return config
  } catch (error) {
    process.stderr.write(`chipbud: ${path}: ${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 2
    return null
  }
}

await main()
