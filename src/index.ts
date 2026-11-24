import { parse as babelParse } from '@babel/parser'
import { resolveGlobals, type ChipbudConfig } from './config.js'
import { locate, severityOf, type Diagnostic } from './diagnostics.js'
import { emitScriptSetup } from './emit.js'
import { AnalysisError, analyze, pluginsFor, type Lang } from './options.js'
import type { BindingKind } from './rewrite.js'
import { compileError, parseSfc, withScriptSetup, type ScriptBlock } from './sfc.js'

export type FileStatus = 'converted' | 'needs-review' | 'skipped' | 'error'

export interface FileResult {
  path: string
  status: FileStatus
  converted: string[]
  dropped: string[]
  diagnostics: Diagnostic[]
  /** The rewritten file. Present only when `status` is `converted`. */
  output: string | null
}

export interface MigrateOptions {
  filename?: string
  config?: ChipbudConfig
}

/**
 * Converts one Vue component's options object into `<script setup>`.
 *
 * The contract: `output` is never null unless the file converted with zero
 * diagnostics. A file is either rewritten as a whole or not at all.
 */
export function migrateSource(source: string, options: MigrateOptions = {}): FileResult {
  const filename = options.filename ?? 'anonymous.vue'
  const parsed = parseSfc(source, filename)
  const script = parsed.script
  const lang: Lang = script ? scriptLang(script) : 'js'

  if (parsed.errors.length > 0) {
    const first = parsed.errors[0] ?? { message: 'Invalid SFC', line: 1, column: 1 }
    const diagnostic: Diagnostic = { code: 'parse-error', message: first.message, line: first.line, column: first.column }

    // Only a broken script is a tool failure. When the script parses (or there is none),
    // the SFC is simply not something Vue 3 accepts, and a human has to decide.
    if (script && !parsesAsScript(script.content, lang)) return result(filename, 'error', [diagnostic])
    return result(filename, 'needs-review', [{ ...diagnostic, code: 'sfc-not-convertible' }])
  }

  if (parsed.hasScriptSetup) {
    return result(filename, 'skipped', [
      { code: 'already-setup', message: 'Already uses `<script setup>`; nothing to convert.', line: 1, column: 1 },
    ])
  }

  if (!script) {
    return result(filename, 'skipped', [
      { code: 'no-script', message: 'This component has no `<script>` block to convert.', line: 1, column: 1 },
    ])
  }

  const at = (offsetInScript: number): { line: number; column: number } => locate(source, script.contentStart + offsetInScript)

  let analyzed: ReturnType<typeof analyze>
  try {
    analyzed = analyze(script.content, lang)
  } catch (error) {
    if (!(error instanceof AnalysisError)) throw error
    return result(filename, error.code === 'parse-error' ? 'error' : 'needs-review', [
      { code: error.code, message: error.message, ...at(error.offset) },
    ])
  }

  const { program, model, importNames } = analyzed
  const diagnostics: Diagnostic[] = []
  const bindings = new Map<string, BindingKind>()

  const bind = (name: string, kind: BindingKind, offset: number): void => {
    if (bindings.has(name)) {
      diagnostics.push({
        code: 'duplicate-binding',
        message: `\`${name}\` is declared more than once across options.`,
        detail: name,
        ...at(offset),
      })
      return
    }
    bindings.set(name, kind)
  }

  for (const entry of model.data) bind(entry.name, 'data', entry.offset)
  for (const entry of model.computed) bind(entry.name, 'computed', entry.offset)
  for (const entry of model.methods) bind(entry.name, 'method', entry.offset)
  for (const name of model.propNames) bind(name, 'prop', model.propsOffset ?? 0)

  // A Vuex helper spread is either converted (when `$store` is mapped) or reported once.
  // Recording its names as `external` keeps one unsupported line from becoming fifty.
  const globals = resolveGlobals(options.config)
  const storeMapped = globals.has('$store')
  for (const spread of model.storeSpreads) {
    const kind: BindingKind =
      !storeMapped ? 'external' : spread.kind === 'actions' || spread.kind === 'mutations' ? 'method' : 'computed'
    for (const entry of spread.entries) bind(entry.alias, kind, entry.offset)
  }

  for (const entry of model.unsupported) {
    diagnostics.push({ code: entry.code, message: entry.message, detail: entry.detail, ...at(entry.offset) })
  }

  const emitted = emitScriptSetup({ source: script.content, program, model, bindings, importNames, globals, lang })
  for (const problem of emitted.problems) {
    diagnostics.push({ code: problem.code, message: problem.message, detail: problem.detail, ...at(problem.offset) })
  }

  const errors = diagnostics.filter((diagnostic) => severityOf(diagnostic.code) === 'error')
  const reviews = diagnostics.filter((diagnostic) => severityOf(diagnostic.code) === 'review')

  if (errors.length > 0) return result(filename, 'error', diagnostics, emitted.converted, emitted.dropped)
  if (reviews.length > 0) return result(filename, 'needs-review', diagnostics, emitted.converted, emitted.dropped)

  const output = withScriptSetup(source, script, emitted.code)
  const invalid = validate(output, emitted.code, lang, filename)
  if (invalid) return result(filename, 'error', [invalid], emitted.converted, emitted.dropped)

  return result(filename, 'converted', diagnostics, emitted.converted, emitted.dropped, output)
}

function validate(output: string, code: string, lang: Lang, filename: string): Diagnostic | null {
  try {
    babelParse(code, { sourceType: 'module', plugins: pluginsFor(lang) })
  } catch (error) {
    return {
      code: 'output-invalid',
      message: `Generated script does not parse: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`,
      line: 1,
      column: 1,
    }
  }

  const failure = compileError(output, filename)
  if (failure) {
    return { code: 'output-invalid', message: `Generated SFC does not compile: ${failure}`, line: 1, column: 1 }
  }

  return null
}

function scriptLang(script: ScriptBlock): Lang {
  if (script.attrs.lang === 'tsx') return 'tsx'
  return script.attrs.lang === 'ts' ? 'ts' : 'js'
}

function parsesAsScript(content: string, lang: Lang): boolean {
  try {
    babelParse(content, { sourceType: 'module', plugins: pluginsFor(lang) })
    return true
  } catch {
    return false
  }
}

function result(
  path: string,
  status: FileStatus,
  diagnostics: Diagnostic[],
  converted: string[] = [],
  dropped: string[] = [],
  output: string | null = null,
): FileResult {
  return { path, status, converted, dropped, diagnostics, output }
}
