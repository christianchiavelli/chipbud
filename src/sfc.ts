import { compileScript, parse } from '@vue/compiler-sfc'

export interface ScriptBlock {
  /** Inner text of the `<script>` block, verbatim. */
  content: string
  /** Offset of `<script` in the file. */
  tagStart: number
  /** Offset of the first character of the block content. */
  contentStart: number
  attrs: Record<string, string | true>
}

export interface SfcError {
  message: string
  line: number
  column: number
}

export interface ParsedSfc {
  script: ScriptBlock | null
  hasScriptSetup: boolean
  errors: SfcError[]
}

export function parseSfc(source: string, filename: string): ParsedSfc {
  const { descriptor, errors } = parse(source, { filename })
  const messages: SfcError[] = errors.map((error) => {
    const location = (error as { loc?: { start: { line: number; column: number } } }).loc
    return {
      message: error instanceof Error ? error.message : String(error),
      line: location?.start.line ?? 1,
      column: location?.start.column ?? 1,
    }
  })

  const block = descriptor.script
  if (!block) {
    return { script: null, hasScriptSetup: Boolean(descriptor.scriptSetup), errors: messages }
  }

  // `block.loc` covers the content, not the tags: find the content first, then walk back to `<script`.
  let contentStart = block.loc.start.offset
  if (source.slice(contentStart, contentStart + block.content.length) !== block.content) {
    const found = source.indexOf(block.content, block.loc.start.offset)
    if (found !== -1) contentStart = found
  }

  const tagStart = source.lastIndexOf('<script', contentStart)
  if (tagStart === -1) {
    return { script: null, hasScriptSetup: Boolean(descriptor.scriptSetup), errors: messages }
  }

  return {
    script: {
      content: block.content,
      tagStart,
      contentStart,
      attrs: block.attrs,
    },
    hasScriptSetup: Boolean(descriptor.scriptSetup),
    errors: messages,
  }
}

/** Rewrites only the script block: the opening tag gains `setup`, the content is replaced. */
export function withScriptSetup(source: string, script: ScriptBlock, content: string): string {
  const before = source.slice(0, script.tagStart)
  const openTag = source.slice(script.tagStart, script.contentStart)
  const after = source.slice(script.contentStart + script.content.length)
  const setupTag = openTag.replace(/^<script(?![a-z])/i, '<script setup')
  return `${before}${setupTag}${content}${after}`
}

/**
 * Runs the Vue compiler over the result. Parsing proves the file is syntactically
 * valid; compiling proves the SFC macros were emitted in a shape Vue accepts.
 */
export function compileError(source: string, filename: string): string | null {
  const { descriptor, errors } = parse(source, { filename })
  const first = errors[0]
  if (first) return first instanceof Error ? first.message : String(first)
  if (!descriptor.scriptSetup) return null

  try {
    compileScript(descriptor, { id: 'chipbud' })
    return null
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}
