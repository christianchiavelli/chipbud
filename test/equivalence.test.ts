// @vitest-environment jsdom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { nextTick, type Component } from 'vue'

import asyncBefore from './fixtures/async-hook.vue'
import asyncAfter from './fixtures/async-hook.expected.vue'
import counterBefore from './fixtures/counter.vue'
import counterAfter from './fixtures/counter.expected.vue'
import emitBefore from './fixtures/emit-untyped.vue'
import emitAfter from './fixtures/emit-untyped.expected.vue'
import nextTickBefore from './fixtures/next-tick.vue'
import nextTickAfter from './fixtures/next-tick.expected.vue'
import propsBefore from './fixtures/props-emits.vue'
import propsAfter from './fixtures/props-emits.expected.vue'
import typedBefore from './fixtures/typed.vue'
import typedAfter from './fixtures/typed.expected.vue'
import watchBefore from './fixtures/watch-created.vue'
import watchAfter from './fixtures/watch-created.expected.vue'

interface Case {
  name: string
  /** The component as written. Vue 3 still runs Options API, so this is a real baseline. */
  before: Component
  /** The same component after chipbud converted it. */
  after: Component
  props?: Record<string, unknown>
  act?: (wrapper: VueWrapper) => Promise<void>
}

const CASES: Case[] = [
  {
    name: 'counter',
    before: counterBefore,
    after: counterAfter,
    act: async (wrapper) => {
      await wrapper.get('button').trigger('click')
      await wrapper.get('button').trigger('click')
    },
  },
  { name: 'props-emits', before: propsBefore, after: propsAfter, props: { amount: 3, currency: 'BRL' } },
  { name: 'typed', before: typedBefore, after: typedAfter },
  { name: 'next-tick', before: nextTickBefore, after: nextTickAfter },
  { name: 'watch-created', before: watchBefore, after: watchAfter, props: { step: 4 } },
  {
    name: 'emit-untyped',
    before: emitBefore,
    after: emitAfter,
    act: async (wrapper) => {
      await wrapper.get('button').trigger('click')
    },
  },
  { name: 'async-hook', before: asyncBefore, after: asyncAfter },
]

const settle = async (): Promise<void> => {
  await flushPromises()
  await nextTick()
}

/** Native events carry timestamps, so they are compared by type instead of by value. */
function summarize(emitted: Record<string, unknown[][]>): Record<string, unknown> {
  const summary: Record<string, unknown> = {}
  for (const [name, calls] of Object.entries(emitted)) {
    summary[name] = calls.map((args) =>
      args.map((argument) => {
        if (argument && typeof argument === 'object' && 'isTrusted' in argument) return argument.constructor.name
        return argument
      }),
    )
  }
  return summary
}

beforeAll(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {})
})

afterAll(() => {
  vi.restoreAllMocks()
})

describe('behaviour is preserved by the conversion', () => {
  it('detects a difference when the two sides diverge', async () => {
    const before = mount(counterBefore)
    const after = mount({ template: '<div>something else</div>' })

    await settle()
    expect(after.html()).not.toBe(before.html())
  })

  for (const testCase of CASES) {
    it(`${testCase.name}: renders the same markup, before and after`, async () => {
      const before = mount(testCase.before, { props: testCase.props })
      const after = mount(testCase.after, { props: testCase.props })

      await settle()
      expect(after.html()).toBe(before.html())

      if (testCase.act) {
        await testCase.act(before)
        await testCase.act(after)
        await settle()
        expect(after.html()).toBe(before.html())
      }
    })

    it(`${testCase.name}: emits the same events`, async () => {
      const before = mount(testCase.before, { props: testCase.props })
      const after = mount(testCase.after, { props: testCase.props })

      await settle()
      if (testCase.act) {
        await testCase.act(before)
        await testCase.act(after)
      }
      await settle()

      expect(summarize(after.emitted())).toEqual(summarize(before.emitted()))
    })
  }
})
