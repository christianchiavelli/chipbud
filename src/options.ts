import { parse as babelParse, type ParserPlugin } from '@babel/parser'
import type {
  BlockStatement,
  Node,
  ObjectExpression,
  ObjectMethod,
  ObjectProperty,
  Program,
  ReturnStatement,
  SpreadElement,
} from '@babel/types'
import type { DiagnosticCode } from './diagnostics.js'
import { walk } from './rewrite.js'

export type Lang = 'ts' | 'tsx' | 'js'

export function pluginsFor(lang: Lang): ParserPlugin[] {
  if (lang === 'tsx') return ['typescript', 'jsx']
  if (lang === 'ts') return ['typescript']
  return ['jsx']
}

export interface FnChunk {
  node: Node
  /** Parameter list source, without parentheses; empty when there are none. */
  params: string
  paramsStart: number
  typeParams: string
  bodyStart: number
  bodyEnd: number
  async: boolean
  generator: boolean
}

export interface DataEntry {
  name: string
  value: Node
  offset: number
}

export interface ComputedEntry {
  name: string
  fn: FnChunk
  offset: number
}

export interface MethodEntry {
  name: string
  fn: FnChunk
  offset: number
}

export interface HookEntry {
  hook: string
  fn: FnChunk
  offset: number
}

export interface WatchEntry {
  source: string
  fn: FnChunk
  offset: number
}

export type StoreKind = 'getters' | 'state' | 'actions' | 'mutations'

export interface StoreEntry {
  /** Name used in the component. */
  alias: string
  /** Name used in the store. */
  key: string
  offset: number
}

export interface StoreSpread {
  helper: string
  kind: StoreKind
  namespace: string | null
  entries: StoreEntry[]
  offset: number
}

export interface Unsupported {
  code: DiagnosticCode
  message: string
  offset: number
  detail?: string
}

export interface OptionsModel {
  name: string | null
  props: string | null
  propsOffset: number | null
  propNames: string[]
  emits: string | null
  data: DataEntry[]
  computed: ComputedEntry[]
  methods: MethodEntry[]
  hooks: HookEntry[]
  watch: WatchEntry[]
  storeSpreads: StoreSpread[]
  created: { fn: FnChunk; hasReturn: boolean } | null
  components: Array<{ name: string; offset: number }>
  unsupported: Unsupported[]
}

export interface AnalyzeResult {
  program: Program
  model: OptionsModel
  importNames: Set<string>
}

export class AnalysisError extends Error {
  constructor(
    readonly code: 'parse-error' | 'option-not-supported',
    message: string,
    readonly offset = 0,
  ) {
    super(message)
    this.name = 'AnalysisError'
  }
}

const HOOKS: Record<string, string> = {
  beforeMount: 'onBeforeMount',
  mounted: 'onMounted',
  beforeUpdate: 'onBeforeUpdate',
  updated: 'onUpdated',
  activated: 'onActivated',
  deactivated: 'onDeactivated',
  beforeDestroy: 'onBeforeUnmount',
  destroyed: 'onUnmounted',
  errorCaptured: 'onErrorCaptured',
}

const NOT_TRANSLATABLE = new Set([
  'beforeCreate',
  'serverPrefetch',
  'render',
  'mixins',
  'extends',
  'filters',
  'directives',
  'provide',
  'inject',
  'inheritAttrs',
  'functional',
  'setup',
  'model',
])

export function analyze(content: string, lang: Lang): AnalyzeResult {
  const program = parseProgram(content, lang)
  const model = emptyModel()
  const importNames = new Set<string>()

  for (const statement of program.body) {
    if (statement.type === 'ImportDeclaration') {
      for (const specifier of statement.specifiers) importNames.add(specifier.local.name)
    }
  }

  const options = findOptionsObject(program)
  if (!options) {
    throw new AnalysisError(
      'option-not-supported',
      'No `export default { ... }` options object was found.',
      program.start ?? 0,
    )
  }

  for (const property of options.properties) {
    if (property.type === 'SpreadElement') {
      model.unsupported.push({
        code: 'spread-option',
        message: 'Spread in the options object cannot be resolved statically.',
        offset: property.start ?? 0,
      })
      continue
    }

    const name = keyName(property)
    if (name === null) {
      model.unsupported.push({
        code: 'option-not-supported',
        message: 'Computed option keys cannot be resolved statically.',
        offset: property.start ?? 0,
      })
      continue
    }

    const offset = property.start ?? 0

    switch (name) {
      case 'name':
        model.name = stringValue(property) ?? reportUnsupported(model, name, offset, '`name` must be a string literal.')
        break
      case 'props':
        readProps(model, property, content, offset)
        break
      case 'emits':
        model.emits = valueText(property, content)
        if (model.emits === null) reportUnsupported(model, name, offset, '`emits` must be an array or an object literal.')
        break
      case 'data':
        readData(model, property, content, offset)
        break
      case 'computed':
        readComputed(model, property, content, offset)
        break
      case 'methods':
        readMethods(model, property, content, offset)
        break
      case 'components':
        readComponents(model, property, offset)
        break
      case 'watch':
        readWatch(model, property, content, offset)
        break
      case 'created':
        readCreated(model, property, content, offset)
        break
      default: {
        const hook = HOOKS[name]
        if (hook) readHook(model, hook, property, content, offset)
        else if (NOT_TRANSLATABLE.has(name)) {
          reportUnsupported(model, name, offset, `\`${name}\` has no mechanical \`<script setup>\` equivalent.`)
        } else {
          reportUnsupported(model, name, offset, `Unknown option \`${name}\`.`)
        }
      }
    }
  }

  return { program, model, importNames }
}

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/

function validBinding(model: OptionsModel, option: string, name: string, offset: number): boolean {
  if (IDENTIFIER.test(name)) return true
  model.unsupported.push({
    code: 'invalid-binding-name',
    message: `\`${option}\` entry \`${name}\` is not a valid JavaScript identifier, so it cannot become a top-level binding.`,
    offset,
    detail: name,
  })
  return false
}

function reportUnsupported(model: OptionsModel, name: string, offset: number, message: string): null {
  model.unsupported.push({ code: 'option-not-supported', message, offset, detail: name })
  return null
}

function emptyModel(): OptionsModel {
  return {
    name: null,
    props: null,
    propsOffset: null,
    propNames: [],
    emits: null,
    data: [],
    computed: [],
    methods: [],
    hooks: [],
    watch: [],
    storeSpreads: [],
    created: null,
    components: [],
    unsupported: [],
  }
}

function parseProgram(content: string, lang: Lang): Program {
  try {
    const ast = babelParse(content, {
      sourceType: 'module',
      errorRecovery: false,
      plugins: pluginsFor(lang),
    })
    return ast.program
  } catch (error) {
    const message = error instanceof Error ? error.message.split('\n')[0] ?? 'Invalid syntax' : String(error)
    throw new AnalysisError('parse-error', message, 0)
  }
}

function findOptionsObject(program: Program): ObjectExpression | null {
  for (const statement of program.body) {
    if (statement.type !== 'ExportDefaultDeclaration') continue
    const unwrapped = unwrap(statement.declaration as Node)
    if (unwrapped.type === 'ObjectExpression') return unwrapped
    if (unwrapped.type === 'CallExpression') {
      const argument = unwrapped.arguments[0]
      if (argument && argument.type === 'ObjectExpression') return argument
    }
    return null
  }
  return null
}

function unwrap(node: Node): Node {
  let current = node
  while (
    current.type === 'TSAsExpression' ||
    current.type === 'TSSatisfiesExpression' ||
    current.type === 'ParenthesizedExpression'
  ) {
    current = current.expression
  }
  return current
}

function keyName(property: ObjectProperty | ObjectMethod): string | null {
  if (!property.computed) {
    if (property.key.type === 'Identifier') return property.key.name
    if (property.key.type === 'StringLiteral') return property.key.value
    if (property.key.type === 'NumericLiteral') return String(property.key.value)
  }
  return null
}

function stringValue(property: ObjectProperty | ObjectMethod): string | null {
  if (property.type === 'ObjectProperty' && property.value.type === 'StringLiteral') return property.value.value
  return null
}

function valueText(property: ObjectProperty | ObjectMethod, content: string): string | null {
  if (property.type !== 'ObjectProperty') return null
  const start = property.value.start
  const end = property.value.end
  if (start == null || end == null) return null
  return content.slice(start, end)
}

function asFunction(property: ObjectProperty | ObjectMethod, content: string): FnChunk | null {
  if (property.type === 'ObjectMethod') {
    if (property.kind !== 'method') return null
    return {
      node: property,
      params: paramsText(property.params, content),
      paramsStart: property.params[0]?.start ?? -1,
      typeParams: typeParamsText(property, content),
      bodyStart: property.body.start ?? 0,
      bodyEnd: property.body.end ?? 0,
      async: property.async,
      generator: property.generator,
    }
  }

  const value = property.value
  if (value.type !== 'FunctionExpression' && value.type !== 'ArrowFunctionExpression') return null
  return {
    node: value,
    params: paramsText(value.params, content),
    paramsStart: value.params[0]?.start ?? -1,
    typeParams: 'typeParameters' in value ? typeParamsText(value, content) : '',
    bodyStart: value.body.start ?? 0,
    bodyEnd: value.body.end ?? 0,
    async: value.async,
    generator: value.type === 'FunctionExpression' ? value.generator : false,
  }
}

function paramsText(params: ReadonlyArray<Node>, content: string): string {
  const first = params[0]
  const last = params[params.length - 1]
  if (!first || !last || first.start == null || last.end == null) return ''
  return content.slice(first.start, last.end)
}

function typeParamsText(node: Node, content: string): string {
  const typeParameters = (node as { typeParameters?: { start?: number | null; end?: number | null } }).typeParameters
  if (!typeParameters || typeParameters.start == null || typeParameters.end == null) return ''
  return content.slice(typeParameters.start, typeParameters.end)
}

function readProps(model: OptionsModel, property: ObjectProperty | ObjectMethod, content: string, offset: number): void {
  const text = valueText(property, content)
  if (text === null || property.type !== 'ObjectProperty') {
    reportUnsupported(model, 'props', offset, '`props` must be an array or an object literal.')
    return
  }
  model.props = text
  model.propsOffset = offset

  const value = property.value
  if (value.type === 'ArrayExpression') {
    for (const element of value.elements) {
      if (element?.type === 'StringLiteral') model.propNames.push(element.value)
      else reportUnsupported(model, 'props', offset, 'Array `props` may only contain string literals.')
    }
    return
  }

  if (value.type === 'ObjectExpression') {
    for (const entry of value.properties) {
      if (entry.type === 'SpreadElement') {
        model.unsupported.push({
          code: 'spread-option',
          message: 'Spread in `props` cannot be resolved statically.',
          offset: entry.start ?? offset,
        })
        continue
      }
      const name = keyName(entry)
      if (name) model.propNames.push(name)
    }
    return
  }

  reportUnsupported(model, 'props', offset, '`props` must be an array or an object literal.')
}

function readData(model: OptionsModel, property: ObjectProperty | ObjectMethod, content: string, offset: number): void {
  const fn = asFunction(property, content)
  if (!fn) {
    reportUnsupported(model, 'data', offset, '`data` must be a function.')
    return
  }

  const returned = returnedObject(fn.node)
  if (!returned) {
    reportUnsupported(model, 'data', offset, '`data` must return a single object literal.')
    return
  }

  for (const entry of returned.properties) {
    if (entry.type === 'SpreadElement') {
      model.unsupported.push({
        code: 'spread-option',
        message: 'Spread in the object returned by `data` cannot be resolved statically.',
        offset: entry.start ?? offset,
      })
      continue
    }
    const name = keyName(entry)
    if (name === null || entry.type !== 'ObjectProperty') {
      model.unsupported.push({
        code: 'data-shape',
        message: 'Only `key: value` pairs are supported in the object returned by `data`.',
        offset: entry.start ?? offset,
      })
      continue
    }
    if (!validBinding(model, 'data', name, entry.start ?? offset)) continue
    model.data.push({ name, value: entry.value, offset: entry.start ?? offset })
  }
}

function returnedObject(node: Node): ObjectExpression | null {
  if (node.type === 'ArrowFunctionExpression' && node.body.type === 'ObjectExpression') return node.body
  const body = (node as { body?: Node }).body
  if (!body || body.type !== 'BlockStatement') return null
  const returns = body.body.filter((statement): statement is ReturnStatement => statement.type === 'ReturnStatement')
  const only = returns[0]
  if (returns.length !== 1 || !only) return null
  const argument = only.argument
  return argument && argument.type === 'ObjectExpression' ? argument : null
}

function readComputed(
  model: OptionsModel,
  property: ObjectProperty | ObjectMethod,
  content: string,
  offset: number,
): void {
  if (property.type !== 'ObjectProperty' && property.type !== 'ObjectMethod') return
  const entries = property.type === 'ObjectProperty' ? objectProperties(property.value) : [property]
  if (entries === null) {
    reportUnsupported(model, 'computed', offset, '`computed` must be an object literal.')
    return
  }

  for (const entry of entries) {
    if (entry.type === 'SpreadElement') {
      readStoreSpread(model, entry, offset)
      continue
    }
    const name = keyName(entry)
    if (name === null) continue

    if (entry.type === 'ObjectProperty' && entry.value.type === 'ObjectExpression') {
      model.unsupported.push({
        code: 'computed-setter',
        message: `\`computed.${name}\` declares a setter; write it as \`computed({ get, set })\` by hand.`,
        offset: entry.start ?? offset,
        detail: name,
      })
      continue
    }

    const fn = asFunction(entry, content)
    if (!fn) {
      reportUnsupported(model, 'computed', entry.start ?? offset, `\`computed.${name}\` is not a function.`)
      continue
    }
    if (!validBinding(model, 'computed', name, entry.start ?? offset)) continue
    model.computed.push({ name, fn, offset: entry.start ?? offset })
  }
}

function objectProperties(value: Node): Array<ObjectProperty | ObjectMethod | SpreadElement> | null {
  if (value.type !== 'ObjectExpression') return null
  return value.properties as Array<ObjectProperty | ObjectMethod | SpreadElement>
}

function readMethods(
  model: OptionsModel,
  property: ObjectProperty | ObjectMethod,
  content: string,
  offset: number,
): void {
  const entries = property.type === 'ObjectProperty' ? objectProperties(property.value) : [property]
  if (entries === null) {
    reportUnsupported(model, 'methods', offset, '`methods` must be an object literal.')
    return
  }

  for (const entry of entries) {
    if (entry.type === 'SpreadElement') {
      readStoreSpread(model, entry, offset)
      continue
    }
    const name = keyName(entry)
    const fn = asFunction(entry, content)
    if (name === null || !fn) {
      reportUnsupported(model, 'methods', entry.start ?? offset, 'Each method must be a function.')
      continue
    }
    if (!validBinding(model, 'methods', name, entry.start ?? offset)) continue
    model.methods.push({ name, fn, offset: entry.start ?? offset })
  }
}

const STORE_HELPERS: Record<string, StoreKind> = {
  mapGetters: 'getters',
  mapState: 'state',
  mapActions: 'actions',
  mapMutations: 'mutations',
}

/**
 * `...mapGetters('user', ['name'])` becomes a `computed` over the store binding, but only
 * when a `$store` mapping exists. Without one the helper is reported once, and the names it
 * brings are recorded as `external` so the file does not produce one diagnostic per usage.
 */
function readStoreSpread(model: OptionsModel, spread: SpreadElement, offset: number): void {
  const start = spread.start ?? offset
  const call = spread.argument

  if (call.type !== 'CallExpression' || call.callee.type !== 'Identifier') {
    model.unsupported.push({
      code: 'spread-option',
      message: 'Only Vuex helper spreads are converted; anything else stays as it is.',
      offset: start,
    })
    return
  }

  const helper = call.callee.name
  const kind = STORE_HELPERS[helper]
  if (!kind) {
    model.unsupported.push({
      code: 'spread-option',
      message: `\`...${helper}(...)\` cannot be resolved statically.`,
      offset: start,
      detail: helper,
    })
    return
  }

  let source = call.arguments[0]
  let namespace: string | null = null

  if (source?.type === 'StringLiteral') {
    namespace = source.value
    source = call.arguments[1]
  }

  if (!source) {
    model.unsupported.push({
      code: 'store-mapping',
      message: `\`...${helper}\` needs an array or an object literal.`,
      offset: start,
    })
    return
  }

  const entries: StoreEntry[] = []

  if (source.type === 'ArrayExpression') {
    for (const element of source.elements) {
      if (element?.type !== 'StringLiteral') {
        model.unsupported.push({
          code: 'store-mapping',
          message: `\`...${helper}\` array entries must be string literals.`,
          offset: element?.start ?? start,
        })
        continue
      }
      entries.push({ alias: element.value, key: element.value, offset: element.start ?? start })
    }
  } else if (source.type === 'ObjectExpression') {
    for (const property of source.properties) {
      if (property.type !== 'ObjectProperty' || property.value.type !== 'StringLiteral') {
        model.unsupported.push({
          code: 'store-mapping',
          message: `\`...${helper}\` with a function value has to be written by hand.`,
          offset: property.start ?? start,
        })
        continue
      }
      const alias = keyName(property)
      if (!alias) continue
      entries.push({ alias, key: property.value.value, offset: property.start ?? start })
    }
  } else {
    model.unsupported.push({
      code: 'store-mapping',
      message: `\`...${helper}\` needs an array or an object literal.`,
      offset: start,
    })
    return
  }

  if (entries.length > 0) {
    model.storeSpreads.push({ helper, kind, namespace, entries, offset: start })
  }
}

function readComponents(model: OptionsModel, property: ObjectProperty | ObjectMethod, offset: number): void {
  if (property.type !== 'ObjectProperty' || property.value.type !== 'ObjectExpression') {
    reportUnsupported(model, 'components', offset, '`components` must be an object literal.')
    return
  }
  for (const entry of property.value.properties) {
    if (entry.type === 'SpreadElement') {
      model.unsupported.push({
        code: 'spread-option',
        message: 'Spread in `components` cannot be resolved statically.',
        offset: entry.start ?? offset,
      })
      continue
    }
    const name = keyName(entry)
    if (name) model.components.push({ name, offset: entry.start ?? offset })
  }
}

function readWatch(model: OptionsModel, property: ObjectProperty | ObjectMethod, content: string, offset: number): void {
  if (property.type !== 'ObjectProperty' || property.value.type !== 'ObjectExpression') {
    reportUnsupported(model, 'watch', offset, '`watch` must be an object literal.')
    return
  }

  for (const entry of property.value.properties) {
    if (entry.type === 'SpreadElement') {
      model.unsupported.push({
        code: 'spread-option',
        message: 'Spread in `watch` cannot be resolved statically.',
        offset: entry.start ?? offset,
      })
      continue
    }

    if (entry.computed || entry.key.type !== 'Identifier') {
      model.unsupported.push({
        code: 'watch-options',
        message: 'Watched keys must be plain identifiers; nested paths need a getter written by hand.',
        offset: entry.start ?? offset,
      })
      continue
    }
    const source = entry.key.name

    if (entry.type === 'ObjectProperty' && entry.value.type === 'ObjectExpression') {
      model.unsupported.push({
        code: 'watch-options',
        message: `\`watch.${source}\` uses \`handler\`/\`deep\`/\`immediate\`; write it as \`watch(source, handler, options)\` by hand.`,
        offset: entry.start ?? offset,
        detail: source,
      })
      continue
    }

    const fn = asFunction(entry, content)
    if (!fn) {
      reportUnsupported(model, 'watch', entry.start ?? offset, `\`watch.${source}\` is not a function.`)
      continue
    }
    model.watch.push({ source, fn, offset: entry.start ?? offset })
  }
}

function readHook(
  model: OptionsModel,
  hook: string,
  property: ObjectProperty | ObjectMethod,
  content: string,
  offset: number,
): void {
  const fn = asFunction(property, content)
  if (!fn) {
    reportUnsupported(model, hook, offset, 'Lifecycle hooks must be functions.')
    return
  }
  model.hooks.push({ hook, fn, offset })
}

function readCreated(
  model: OptionsModel,
  property: ObjectProperty | ObjectMethod,
  content: string,
  offset: number,
): void {
  const fn = asFunction(property, content)
  if (!fn) {
    reportUnsupported(model, 'created', offset, '`created` must be a function.')
    return
  }
  const body = (fn.node as { body?: BlockStatement }).body
  if (!body || body.type !== 'BlockStatement') {
    reportUnsupported(model, 'created', offset, '`created` must have a block body.')
    return
  }
  let hasReturn = false
  walk(body, (node) => {
    if (node.type === 'ReturnStatement') hasReturn = true
  })
  model.created = { fn, hasReturn }
}
