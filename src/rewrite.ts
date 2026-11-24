import type { Node } from '@babel/types'
import type { GlobalMapping } from './config.js'
import type { DiagnosticCode } from './diagnostics.js'

export type BindingKind = 'data' | 'computed' | 'method' | 'prop' | 'external'

export interface Edit {
  start: number
  end: number
  text: string
}

export interface RewriteProblem {
  code: DiagnosticCode
  message: string
  /** Offset relative to the start of the script block. */
  offset: number
  detail?: string
}

export interface RewriteContext {
  bindings: Map<string, BindingKind>
  emitsDeclared: boolean
  globals: Map<string, GlobalMapping>
}

export interface RewritePlan {
  edits: Edit[]
  problems: RewriteProblem[]
  usesProps: boolean
  usesEmit: boolean
  /** `$`-properties that were rewritten, so the caller can emit their imports. */
  globalsUsed: Set<string>
}

const SKIPPED_KEYS = new Set([
  'loc',
  'start',
  'end',
  'range',
  'extra',
  'comments',
  'tokens',
  'errors',
  'leadingComments',
  'trailingComments',
  'innerComments',
])

/** Instance properties whose message is worth more than "not supported". */
const REMOVED_IN_VUE_3: Record<string, string> = {
  $set: 'Vue 3 removed `this.$set`: assign to the property directly.',
  $delete: 'Vue 3 removed `this.$delete`: delete straight from the reactive object.',
  $listeners: 'Vue 3 folded `this.$listeners` into `this.$attrs`.',
  $scopedSlots: 'Vue 3 folded `this.$scopedSlots` into `this.$slots`.',
}

/** Nodes that introduce their own `this`. Arrow functions do not. */
function bindsOwnThis(node: Node): boolean {
  switch (node.type) {
    case 'FunctionExpression':
    case 'FunctionDeclaration':
    case 'ObjectMethod':
    case 'ClassMethod':
    case 'ClassPrivateMethod':
      return true
    default:
      return false
  }
}

function scanThis(
  root: Node,
  visit: (node: Node, parent: Node | null, nested: boolean) => void,
): void {
  const step = (node: Node | null | undefined, parent: Node | null, nested: boolean): void => {
    if (!node || typeof node !== 'object') return
    if (typeof (node as { type?: unknown }).type !== 'string') return

    visit(node, parent, nested)

    const childNested = nested || (node !== root && bindsOwnThis(node))
    for (const key of Object.keys(node)) {
      if (SKIPPED_KEYS.has(key)) continue
      const value = (node as unknown as Record<string, unknown>)[key]
      if (Array.isArray(value)) {
        for (const item of value) step(item as Node | null, node, childNested)
      } else if (value && typeof value === 'object' && typeof (value as { type?: unknown }).type === 'string') {
        step(value as Node, node, childNested)
      }
    }
  }

  step(root, null, false)
}

export function walk(
  node: Node | null | undefined,
  visit: (node: Node, parent: Node | null) => void,
  parent: Node | null = null,
): void {
  if (!node || typeof node !== 'object') return
  if (typeof (node as { type?: unknown }).type !== 'string') return
  visit(node, parent)
  for (const key of Object.keys(node)) {
    if (SKIPPED_KEYS.has(key)) continue
    const value = (node as unknown as Record<string, unknown>)[key]
    if (Array.isArray(value)) {
      for (const item of value) walk(item as Node | null, visit, node)
    } else if (value && typeof value === 'object' && typeof (value as { type?: unknown }).type === 'string') {
      walk(value as Node, visit, node)
    }
  }
}

/** Every name bound anywhere inside `node`. Over-approximated on purpose: shadowing is checked, not guessed. */
export function boundNames(node: Node): Set<string> {
  const names = new Set<string>()
  walk(node, (current) => {
    switch (current.type) {
      case 'VariableDeclarator':
        collectPatternNames(current.id, names)
        break
      case 'FunctionDeclaration':
      case 'FunctionExpression':
      case 'ArrowFunctionExpression':
      case 'ObjectMethod':
        for (const param of current.params) collectPatternNames(param, names)
        break
      case 'CatchClause':
        if (current.param) collectPatternNames(current.param, names)
        break
      default:
        break
    }
  })
  return names
}

export function collectPatternNames(pattern: Node, names: Set<string>): void {
  switch (pattern.type) {
    case 'Identifier':
      names.add(pattern.name)
      break
    case 'ObjectPattern':
      for (const property of pattern.properties) {
        if (property.type === 'RestElement') collectPatternNames(property.argument, names)
        else collectPatternNames(property.value, names)
      }
      break
    case 'ArrayPattern':
      for (const element of pattern.elements) if (element) collectPatternNames(element, names)
      break
    case 'AssignmentPattern':
      collectPatternNames(pattern.left, names)
      break
    case 'RestElement':
      collectPatternNames(pattern.argument, names)
      break
    default:
      break
  }
}

function isAssignmentTarget(node: Node, parent: Node | null): boolean {
  if (!parent) return false
  if (parent.type === 'AssignmentExpression') return parent.left === node
  if (parent.type === 'UpdateExpression') return parent.argument === node
  return false
}

/**
 * Turns every `this.x` inside `node` into the `<script setup>` equivalent:
 * data becomes `x.value`, computed and methods become bare identifiers,
 * props become `props.x`, `this.$emit(...)` becomes `emit(...)`, and a mapped
 * `$property` becomes the local name it maps to.
 *
 * Anything it cannot prove is recorded as a problem instead of guessed.
 */
export function planThisRewrites(node: Node, context: RewriteContext): RewritePlan {
  const edits: Edit[] = []
  const problems: RewriteProblem[] = []
  const locallyBound = boundNames(node)
  const globalsUsed = new Set<string>()
  let usesProps = false
  let usesEmit = false

  scanThis(node, (current, parent, nested) => {
    if (current.type === 'ThisExpression') {
      if (nested) {
        problems.push({
          code: 'this-nested-function',
          message: '`this` inside a plain function is not the component instance; only arrow functions keep it.',
          offset: current.start ?? 0,
        })
        return
      }

      const insideMember = parent?.type === 'MemberExpression' && parent.object === current
      if (!insideMember) {
        problems.push({
          code: 'this-unresolved',
          message: 'Bare `this` has no `<script setup>` equivalent.',
          offset: current.start ?? 0,
        })
      }
      return
    }

    if (current.type !== 'MemberExpression' || current.object.type !== 'ThisExpression') return
    if (nested) return

    const property = current.property
    if (current.computed || property.type !== 'Identifier') {
      problems.push({
        code: 'this-unresolved',
        message: 'Computed access on `this` cannot be resolved statically.',
        offset: current.start ?? 0,
      })
      return
    }

    const name = property.name
    const offset = current.start ?? 0

    if (name === '$emit') {
      const isCalled = parent?.type === 'CallExpression' && parent.callee === current
      if (!isCalled) {
        problems.push({
          code: 'this-unresolved',
          message: '`this.$emit` is used as a value, not called.',
          offset,
        })
        return
      }
      usesEmit = true
      edits.push({ start: current.start ?? 0, end: current.end ?? 0, text: 'emit' })
      return
    }

    const mapped = context.globals.get(name)
    if (mapped) {
      globalsUsed.add(name)
      edits.push({ start: current.start ?? 0, end: current.end ?? 0, text: mapped.as })
      return
    }

    if (name.startsWith('$')) {
      problems.push({
        code: 'this-instance-property',
        message: REMOVED_IN_VUE_3[name] ?? `\`this.${name}\` has no automatic \`<script setup>\` equivalent.`,
        offset,
        detail: name,
      })
      return
    }

    const kind = context.bindings.get(name)
    if (!kind) {
      problems.push({
        code: 'this-unresolved',
        message: `\`this.${name}\` does not resolve to a binding this tool converts.`,
        offset,
        detail: name,
      })
      return
    }

    // Provided by a helper this file refuses to convert; the helper already reported itself.
    if (kind === 'external') return

    if (locallyBound.has(name)) {
      problems.push({
        code: 'this-shadowed',
        message: `\`this.${name}\` is shadowed by a local binding in the same function.`,
        offset,
        detail: name,
      })
      return
    }

    if (isAssignmentTarget(current, parent) && kind !== 'data') {
      problems.push({
        code: 'this-assigned',
        message: `\`this.${name}\` is written to, but converted \`${kind}\` bindings are read-only.`,
        offset,
        detail: name,
      })
      return
    }

    if (kind === 'data') {
      edits.push({ start: current.start ?? 0, end: current.end ?? 0, text: `${name}.value` })
      return
    }

    if (kind === 'prop') {
      usesProps = true
      edits.push({ start: current.object.start ?? 0, end: property.start ?? 0, text: 'props.' })
      return
    }

    edits.push({ start: current.object.start ?? 0, end: property.start ?? 0, text: '' })
  })

  return { edits, problems, usesProps, usesEmit, globalsUsed }
}

/** Applies the edits that fall entirely inside `[offset, offset + text.length)`. */
export function applyEdits(text: string, offset: number, edits: Edit[]): string {
  const inside = edits
    .filter((edit) => edit.start >= offset && edit.end <= offset + text.length)
    .map((edit) => ({ start: edit.start - offset, end: edit.end - offset, text: edit.text }))
    .sort((a, b) => b.start - a.start)

  let output = text
  for (const edit of inside) {
    output = output.slice(0, edit.start) + edit.text + output.slice(edit.end)
  }
  return output
}
