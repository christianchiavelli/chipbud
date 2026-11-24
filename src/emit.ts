import type { Node, Program } from '@babel/types'
import { storeBinding, type GlobalMapping } from './config.js'
import type { FnChunk, OptionsModel, StoreSpread } from './options.js'
import {
  applyEdits,
  collectPatternNames,
  planThisRewrites,
  type BindingKind,
  type Edit,
  type RewriteContext,
  type RewriteProblem,
} from './rewrite.js'

export interface EmitInput {
  source: string
  program: Program
  model: OptionsModel
  bindings: Map<string, BindingKind>
  importNames: Set<string>
  globals: Map<string, GlobalMapping>
  lang: 'ts' | 'tsx' | 'js'
}

export interface EmitResult {
  code: string
  converted: string[]
  dropped: string[]
  problems: RewriteProblem[]
}

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/

export function emitScriptSetup(input: EmitInput): EmitResult {
  const { source, program, model, bindings, importNames, globals, lang } = input

  const context: RewriteContext = { bindings, emitsDeclared: model.emits !== null, globals }
  const vue = new Set<string>()
  const otherImports = new Map<string, Set<string>>()
  const globalsUsed = new Set<string>()
  const problems: RewriteProblem[] = []
  const converted: string[] = []
  const dropped: string[] = []
  const data: string[] = []
  const computed: string[] = []
  const methods: string[] = []
  const hooks: string[] = []
  const watchers: string[] = []
  const created: string[] = []
  let usesProps = false
  let usesEmit = false

  function planNode(node: Node): Edit[] {
    const plan = planThisRewrites(node, context)
    usesProps = usesProps || plan.usesProps
    usesEmit = usesEmit || plan.usesEmit
    for (const name of plan.globalsUsed) globalsUsed.add(name)
    problems.push(...plan.problems)
    return plan.edits
  }

  function planFunction(fn: FnChunk): Edit[] {
    return planNode(fn.node)
  }

  function slice(start: number, end: number, edits: Edit[]): string {
    return applyEdits(source.slice(start, end), start, edits)
  }

  function paramsOf(fn: FnChunk, edits: Edit[]): string {
    if (fn.params === '') return '()'
    return `(${slice(fn.paramsStart, fn.paramsStart + fn.params.length, edits)})`
  }

  function bodyOf(fn: FnChunk, edits: Edit[]): string {
    return formatBlock(slice(fn.bodyStart, fn.bodyEnd, edits), 2)
  }

  for (const entry of model.data) {
    vue.add('ref')
    const edits = planNode(entry.value)
    data.push(`const ${entry.name} = ref(${slice(entry.value.start ?? 0, entry.value.end ?? 0, edits)})`)
    converted.push(`data.${entry.name}`)
  }

  for (const entry of model.computed) {
    vue.add('computed')

    if (entry.fn.async) {
      problems.push({
        code: 'option-not-supported',
        message: 'An `async` computed has no valid `computed()` equivalent.',
        offset: entry.offset,
        detail: entry.name,
      })
      continue
    }

    const edits = planFunction(entry.fn)
    const body = bodyOf(entry.fn, edits)

    if (/\barguments\b/.test(body)) {
      problems.push({
        code: 'arguments-used',
        message: '`arguments` has no meaning inside the arrow function used for a computed property.',
        offset: entry.offset,
      })
    }

    const returned = singleReturn(entry.fn.node, source)
    let expression: string
    if (returned) {
      const value = slice(returned.start, returned.end, edits)
      expression = value.startsWith('{') ? `(${value})` : value
    } else {
      expression = body
    }

    computed.push(`const ${entry.name} = computed(() => ${expression})`)
    converted.push(`computed.${entry.name}`)
  }

  for (const entry of model.methods) {
    const fn = entry.fn
    if (fn.generator) {
      problems.push({
        code: 'option-not-supported',
        message: 'Generator methods cannot be moved out of the options object mechanically.',
        offset: entry.offset,
        detail: entry.name,
      })
      continue
    }

    const edits = planFunction(fn)
    if (fn.node.type === 'ObjectMethod') {
      const async = fn.async ? 'async ' : ''
      methods.push(`${async}function ${entry.name}${fn.typeParams}${paramsOf(fn, edits)} ${bodyOf(fn, edits)}`)
    } else {
      methods.push(`const ${entry.name} = ${slice(fn.node.start ?? 0, fn.node.end ?? 0, edits)}`)
    }
    converted.push(`method.${entry.name}`)
  }

  for (const entry of model.hooks) {
    vue.add(entry.hook)
    const edits = planFunction(entry.fn)
    const async = entry.fn.async ? 'async ' : ''
    hooks.push(`${entry.hook}(${async}() => ${bodyOf(entry.fn, edits)})`)
    converted.push(`lifecycle.${entry.hook}`)
  }

  for (const entry of model.watch) {
    vue.add('watch')
    const edits = planFunction(entry.fn)
    const async = entry.fn.async ? 'async ' : ''
    watchers.push(`watch(${entry.source}, ${async}${paramsOf(entry.fn, edits)} => ${bodyOf(entry.fn, edits)})`)
    converted.push(`watch.${entry.source}`)
  }

  if (model.created) {
    if (model.created.hasReturn) {
      problems.push({
        code: 'option-not-supported',
        message: '`created` returns a value; top-level setup code cannot.',
        offset: model.created.fn.bodyStart,
        detail: 'created',
      })
    } else if (model.created.fn.async) {
      problems.push({
        code: 'option-not-supported',
        message: 'An `async` `created` would turn setup into an async setup and change when the component renders.',
        offset: model.created.fn.bodyStart,
        detail: 'created',
      })
    } else {
      const edits = planFunction(model.created.fn)
      const body = stripIndent(slice(model.created.fn.bodyStart + 1, model.created.fn.bodyEnd - 1, edits))
      if (body !== '') {
        created.push(body)
        converted.push('lifecycle.created')
      }
    }
  }

  const store = storeBinding(globals)
  const storeComputed: string[] = []
  const storeMethods: string[] = []

  for (const spread of model.storeSpreads) {
    if (store === null) {
      const names = spread.entries.map((entry) => entry.alias).join(', ')
      problems.push({
        code: 'store-not-mapped',
        message: `\`...${spread.helper}(...)\` needs a \`$store\` mapping in chipbud.config.json; it provides ${names}.`,
        offset: spread.offset,
        detail: spread.helper,
      })
      continue
    }

    globalsUsed.add('$store')

    for (const entry of spread.entries) {
      const target =
        spread.kind === 'getters' || spread.kind === 'state'
          ? storeMember(spread, entry.key, store)
          : storeCall(spread, entry.key, store, lang)

      if (spread.kind === 'getters' || spread.kind === 'state') {
        vue.add('computed')
        storeComputed.push(`const ${entry.alias} = computed(() => ${target})`)
      } else {
        storeMethods.push(`const ${entry.alias} = ${target}`)
      }
      converted.push(`store.${spread.helper}.${entry.alias}`)
    }
  }

  computed.push(...storeComputed)
  methods.unshift(...storeMethods)

  for (const entry of model.components) {
    if (importNames.has(entry.name)) {
      dropped.push(`component.${entry.name}`)
    } else {
      problems.push({
        code: 'component-not-imported',
        message: `\`components.${entry.name}\` only works in \`<script setup>\` when \`${entry.name}\` is imported.`,
        offset: entry.offset,
        detail: entry.name,
      })
    }
  }

  const statements: string[] = []

  for (const name of [...globalsUsed].sort()) {
    const mapping = globals.get(name)
    if (!mapping) continue
    const imported = mapping.call ?? mapping.as
    if (mapping.from === 'vue') vue.add(imported)
    else {
      const names = otherImports.get(mapping.from) ?? new Set<string>()
      names.add(imported)
      otherImports.set(mapping.from, names)
    }
    if (mapping.call) statements.push(`const ${mapping.as} = ${mapping.call}()`)
  }

  const reserved = new Set<string>(vue)
  for (const mapping of globals.values()) reserved.add(mapping.as)
  if (model.props !== null && usesProps) reserved.add('props')
  if (usesEmit) reserved.add('emit')
  for (const name of topLevelNames(program)) reserved.add(name)

  for (const entry of [...model.data, ...model.computed, ...model.methods]) {
    if (!reserved.has(entry.name)) continue
    problems.push({
      code: 'name-collision',
      message: `\`${entry.name}\` would be declared twice in the same scope once it becomes a top-level binding.`,
      offset: entry.offset,
      detail: entry.name,
    })
  }

  if (model.name !== null) {
    statements.push(`defineOptions({ name: '${model.name}' })`)
    converted.push('option.name')
  }

  if (model.props !== null) {
    const props = formatBlock(model.props, 2)
    statements.push(usesProps ? `const props = defineProps(${props})` : `defineProps(${props})`)
    converted.push('option.props')
  }

  if (model.emits !== null) {
    const emits = formatBlock(model.emits, 2)
    statements.push(usesEmit ? `const emit = defineEmits(${emits})` : `defineEmits(${emits})`)
    converted.push('option.emits')
  } else if (usesEmit) {
    // Vue 3 does not require `emits`, so the component keeps working with an untyped emit.
    const generic = lang === 'js' ? '' : '<{ (event: string, ...args: any[]): void }>'
    statements.push(`const emit = defineEmits${generic}()`)
    converted.push('option.emits')
  }

  statements.push(...data, ...computed, ...methods, ...hooks, ...watchers, ...created)

  const imports: string[] = []
  if (vue.size > 0) imports.push(`import { ${[...vue].sort().join(', ')} } from 'vue'`)
  for (const [from, names] of otherImports) {
    imports.push(`import { ${[...names].sort().join(', ')} } from '${from}'`)
  }

  const bodyText = statements.join('\n')
  const helpers = new Set(model.storeSpreads.map((spread) => spread.helper))

  for (const statement of program.body) {
    if (statement.type === 'ExportDefaultDeclaration') continue
    if (statement.start == null || statement.end == null) continue
    const text = source.slice(statement.start, statement.end)

    if (statement.type === 'ImportDeclaration') {
      // A Vuex helper that no longer appears in the output leaves an import behind.
      const unused = statement.specifiers.every(
        (specifier) =>
          helpers.has(specifier.local.name) &&
          !new RegExp(`\\b${specifier.local.name}\\b`).test(bodyText),
      )
      if (!unused) imports.push(text)
      continue
    }

    statements.push(text)
  }

  const groups = [imports, statements.filter((line) => line.trim() !== '')]
    .filter((group) => group.length > 0)
    .map((group) => group.join('\n'))

  return { code: groups.length > 0 ? `\n${groups.join('\n\n')}\n` : '\n', converted, dropped, problems }
}

function storeMember(spread: StoreSpread, key: string, store: string): string {
  if (spread.kind === 'getters') {
    const name = spread.namespace ? `${spread.namespace}/${key}` : key
    return spread.namespace === null && IDENTIFIER.test(key)
      ? `${store}.getters.${key}`
      : `${store}.getters['${name}']`
  }

  if (spread.namespace !== null) return `${store}.state.${spread.namespace}.${key}`
  return IDENTIFIER.test(key) ? `${store}.state.${key}` : `${store}.state['${key}']`
}

function storeCall(spread: StoreSpread, key: string, store: string, lang: EmitInput['lang']): string {
  const name = spread.namespace ? `${spread.namespace}/${key}` : key
  const verb = spread.kind === 'actions' ? 'dispatch' : 'commit'
  const rest = lang === 'js' ? '...args' : '...args: any[]'
  return `(${rest}) => ${store}.${verb}('${name}', ...args)`
}

function topLevelNames(program: Program): Set<string> {
  const names = new Set<string>()
  for (const statement of program.body) collectDeclarationNames(statement, names)
  return names
}

function collectDeclarationNames(statement: Node, names: Set<string>): void {
  switch (statement.type) {
    case 'ImportDeclaration':
      for (const specifier of statement.specifiers) names.add(specifier.local.name)
      break
    case 'VariableDeclaration':
      for (const declarator of statement.declarations) collectPatternNames(declarator.id, names)
      break
    case 'FunctionDeclaration':
    case 'ClassDeclaration':
    case 'TSInterfaceDeclaration':
    case 'TSTypeAliasDeclaration':
      if (statement.id) names.add(statement.id.name)
      break
    case 'ExportNamedDeclaration':
      if (statement.declaration) collectDeclarationNames(statement.declaration, names)
      break
    default:
      break
  }
}

function singleReturn(node: Node, source: string): { start: number; end: number } | null {
  const body = (node as { body?: { type?: string; body?: unknown[]; start?: number | null; end?: number | null } }).body
  if (!body || body.type !== 'BlockStatement' || !Array.isArray(body.body) || body.body.length !== 1) return null

  const only = body.body[0] as {
    type?: string
    start?: number | null
    end?: number | null
    argument?: { start?: number | null; end?: number | null } | null
  }
  if (only.type !== 'ReturnStatement' || !only.argument) return null

  const { start, end } = only.argument
  if (start == null || end == null || body.start == null || body.end == null) return null
  if (only.start == null || only.end == null) return null

  const before = source.slice(body.start + 1, only.start)
  const after = source.slice(only.end, body.end - 1)
  if (/\/\/|\/\*/.test(before) || /\/\/|\/\*/.test(after)) return null

  return { start, end }
}

/** Re-indents a `{ ... }` block lifted out of a wrapper object, so it reads as top-level code. */
function formatBlock(text: string, innerIndent: number): string {
  if (!text.includes('\n')) return text

  const lines = text.split('\n')
  const head = lines[0] ?? ''
  const tail = lines[lines.length - 1] ?? ''
  const inner = lines.slice(1, -1)
  const min = minimumIndent(inner)
  const pad = ' '.repeat(innerIndent)
  const shifted = inner.map((line) => (line.trim() === '' ? '' : `${pad}${line.slice(min)}`))

  return [head, ...shifted, tail.trim()].join('\n')
}

function stripIndent(text: string): string {
  const lines = text.split('\n')
  const min = minimumIndent(lines)
  return lines
    .map((line) => (line.trim() === '' ? '' : line.slice(min)))
    .join('\n')
    .trim()
}

function minimumIndent(lines: string[]): number {
  const indents = lines
    .filter((line) => line.trim() !== '')
    .map((line) => /^\s*/.exec(line)?.[0].length ?? 0)
  return indents.length > 0 ? Math.min(...indents) : 0
}
