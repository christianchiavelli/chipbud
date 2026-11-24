export type DiagnosticCode =
  | 'parse-error'
  | 'read-error'
  | 'no-script'
  | 'already-setup'
  | 'output-invalid'
  | 'sfc-not-convertible'
  | 'option-not-supported'
  | 'spread-option'
  | 'store-not-mapped'
  | 'store-mapping'
  | 'data-shape'
  | 'computed-setter'
  | 'watch-options'
  | 'component-not-imported'
  | 'duplicate-binding'
  | 'invalid-binding-name'
  | 'name-collision'
  | 'this-instance-property'
  | 'this-unresolved'
  | 'this-shadowed'
  | 'this-nested-function'
  | 'this-assigned'
  | 'arguments-used'

export type DiagnosticSeverity = 'review' | 'error' | 'info'

export interface Diagnostic {
  code: DiagnosticCode
  message: string
  line: number
  column: number
  detail?: string
}

const SEVERITY: Record<DiagnosticCode, DiagnosticSeverity> = {
  'parse-error': 'error',
  'read-error': 'error',
  'output-invalid': 'error',
  'no-script': 'info',
  'already-setup': 'info',
  'sfc-not-convertible': 'review',
  'option-not-supported': 'review',
  'spread-option': 'review',
  'store-not-mapped': 'review',
  'store-mapping': 'review',
  'data-shape': 'review',
  'computed-setter': 'review',
  'watch-options': 'review',
  'component-not-imported': 'review',
  'duplicate-binding': 'review',
  'invalid-binding-name': 'review',
  'name-collision': 'review',
  'this-instance-property': 'review',
  'this-unresolved': 'review',
  'this-shadowed': 'review',
  'this-nested-function': 'review',
  'this-assigned': 'review',
  'arguments-used': 'review',
}

export function severityOf(code: DiagnosticCode): DiagnosticSeverity {
  return SEVERITY[code]
}

/** 1-based line and column for an absolute offset in `source`. */
export function locate(source: string, offset: number): { line: number; column: number } {
  const upTo = source.slice(0, Math.max(0, offset))
  const line = upTo.split('\n').length
  const column = upTo.length - upTo.lastIndexOf('\n')
  return { line, column }
}
