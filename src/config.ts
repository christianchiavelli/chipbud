export interface GlobalMapping {
  /** Module the identifier comes from. */
  from: string
  /** Local name used in the converted file. */
  as: string
  /** When present, the module exports a factory called once: `const <as> = <call>()`. */
  call?: string
}

export interface ChipbudConfig {
  globals?: Record<string, GlobalMapping>
}

/** Mappings that are true for every Vue 3 project, so they need no configuration. */
export const BUILTIN_GLOBALS: Record<string, GlobalMapping> = {
  $nextTick: { from: 'vue', as: 'nextTick' },
}

export function resolveGlobals(config: ChipbudConfig | undefined): Map<string, GlobalMapping> {
  const globals = new Map<string, GlobalMapping>(Object.entries(BUILTIN_GLOBALS))
  if (!config?.globals) return globals

  for (const [key, value] of Object.entries(config.globals)) {
    if (!key.startsWith('$')) throw new Error(`globals keys must start with "$", got "${key}"`)
    if (!value?.from || !value?.as) throw new Error(`globals["${key}"] needs both "from" and "as"`)
    globals.set(key, value)
  }
  return globals
}

/** Vuex, Pinia or anything else mapped to `$store`: the binding the helper spreads need. */
export function storeBinding(globals: Map<string, GlobalMapping>): string | null {
  return globals.get('$store')?.as ?? null
}
