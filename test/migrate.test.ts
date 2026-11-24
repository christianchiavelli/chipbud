import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { resolveGlobals, type ChipbudConfig } from '../src/config.js'
import { migrateSource, type FileResult } from '../src/index.js'
import { buildReport, renderMarkdown } from '../src/report.js'

const fixture = (name: string): string =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')

const VUEX: ChipbudConfig = { globals: { $store: { from: 'vuex', as: 'store', call: 'useStore' } } }

const CONVERTED: ReadonlyArray<{ name: string; config?: ChipbudConfig }> = [
  { name: 'counter' },
  { name: 'props-emits' },
  { name: 'typed' },
  { name: 'components' },
  { name: 'watch-created' },
  { name: 'next-tick' },
  { name: 'async-hook' },
  { name: 'emit-untyped' },
  { name: 'store-spread', config: VUEX },
]

const REFUSED: ReadonlyArray<readonly [string, string]> = [
  ['mixin', 'option-not-supported'],
  ['refs', 'this-instance-property'],
  ['shadowed', 'this-shadowed'],
  ['nested-this', 'this-nested-function'],
  ['collision', 'name-collision'],
  ['reserved-ref', 'name-collision'],
  ['dashed-key', 'invalid-binding-name'],
  ['store-spread', 'store-not-mapped'],
  ['async-created', 'option-not-supported'],
]

describe('conversion', () => {
  for (const { name, config } of CONVERTED) {
    it(`rewrites ${name} exactly`, () => {
      const result = migrateSource(fixture(`${name}.vue`), { filename: `${name}.vue`, config })

      expect(result.diagnostics).toEqual([])
      expect(result.status).toBe('converted')
      expect(result.output).toBe(fixture(`${name}.expected.vue`))
    })
  }

  it('leaves the template byte for byte', () => {
    const source = fixture('counter.vue')
    const template = source.slice(0, source.indexOf('<script>'))
    const output = migrateSource(source, { filename: 'counter.vue' }).output ?? ''

    expect(output.startsWith(template)).toBe(true)
  })

  it('is idempotent: every converted output is left alone on a second run', () => {
    for (const { name, config } of CONVERTED) {
      const result = migrateSource(fixture(`${name}.expected.vue`), {
        filename: `${name}.expected.vue`,
        config,
      })

      expect(result.status).toBe('skipped')
      expect(result.output).toBeNull()
      expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(['already-setup'])
    }
  })

  it('parses plain JavaScript that contains JSX instead of reporting a parse error', () => {
    const result = migrateSource(fixture('jsx.vue'), { filename: 'jsx.vue' })
    const codes = result.diagnostics.map((diagnostic) => diagnostic.code)

    expect(codes).not.toContain('parse-error')
    expect(codes).toContain('option-not-supported')
  })
})

describe('refusal', () => {
  for (const [name, code] of REFUSED) {
    it(`refuses ${name} with ${code}`, () => {
      const result = migrateSource(fixture(`${name}.vue`), { filename: `${name}.vue` })
      const codes = result.diagnostics.map((diagnostic) => diagnostic.code)

      expect(result.status).toBe('needs-review')
      expect(result.output).toBeNull()
      expect(codes).toContain(code)
    })
  }

  it('points at the line inside the .vue file, not the script block', () => {
    const result = migrateSource(fixture('refs.vue'), { filename: 'refs.vue' })
    const [diagnostic] = result.diagnostics

    expect(diagnostic?.line).toBe(9)
    expect(diagnostic?.column).toBe(7)
  })

  it('reports an unmapped store helper once instead of every name it provides', () => {
    const result = migrateSource(fixture('store-spread.vue'), { filename: 'store-spread.vue' })
    const codes = result.diagnostics.map((diagnostic) => diagnostic.code)

    expect(codes.filter((code) => code === 'store-not-mapped')).toHaveLength(3)
    expect(codes).not.toContain('this-unresolved')
  })
})

describe('config', () => {
  it('rejects a mapping that is not an instance property', () => {
    expect(() => resolveGlobals({ globals: { store: { from: 'vuex', as: 'store' } } })).toThrow()
  })

  it('rejects a mapping without a target name', () => {
    expect(() => resolveGlobals({ globals: { $store: { from: 'vuex', as: '' } } })).toThrow()
  })

  it('keeps the built-in mappings when a config is present', () => {
    expect(resolveGlobals(VUEX).get('$nextTick')?.as).toBe('nextTick')
  })
})

describe('report', () => {
  it('summarises a run without leaking the rewritten source', () => {
    const report = buildReport([
      migrateSource(fixture('counter.vue'), { filename: 'counter.vue' }),
      migrateSource(fixture('mixin.vue'), { filename: 'mixin.vue' }),
      migrateSource(fixture('already-setup.vue'), { filename: 'already-setup.vue' }),
    ])

    expect(report.summary).toEqual({ checked: 3, converted: 1, needsReview: 1, skipped: 1, errors: 0 })
    expect(report.files.every((file) => !('output' in file))).toBe(true)
  })

  it('groups repeated diagnostics instead of listing every occurrence', () => {
    const base = migrateSource(fixture('refs.vue'), { filename: 'refs.vue' })
    const noisy: FileResult = {
      ...base,
      diagnostics: Array.from({ length: 8 }, (_, index) => ({
        code: 'this-instance-property' as const,
        message: '`this.$refs` has no automatic `<script setup>` equivalent.',
        line: index + 1,
        column: 1,
      })),
    }

    const markdown = renderMarkdown(buildReport([noisy]))
    const listed = markdown.split('\n').filter((line) => line.startsWith('- `this-instance-property`'))

    expect(listed).toHaveLength(5)
    expect(markdown).toContain('... and 3 more')
  })
})
