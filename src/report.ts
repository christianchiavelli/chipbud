import type { FileResult } from './index.js'
import { severityOf } from './diagnostics.js'

const LISTED_PER_CODE = 5
const LISTED_IN_TABLE = 4

export type ReportFile = Omit<FileResult, 'output'>

export interface Report {
  tool: 'chipbud'
  formatVersion: 1
  summary: {
    checked: number
    converted: number
    needsReview: number
    skipped: number
    errors: number
  }
  files: ReportFile[]
}

export function buildReport(results: FileResult[]): Report {
  const count = (status: FileResult['status']): number => results.filter((file) => file.status === status).length

  return {
    tool: 'chipbud',
    formatVersion: 1,
    summary: {
      checked: results.length,
      converted: count('converted'),
      needsReview: count('needs-review'),
      skipped: count('skipped'),
      errors: count('error'),
    },
    files: results.map(({ output: _output, ...rest }) => rest),
  }
}

export function renderMarkdown(report: Report): string {
  const { summary } = report
  const lines: string[] = []

  lines.push(
    `${summary.checked} file(s): ${summary.converted} converted, ${summary.needsReview} needs review, ` +
      `${summary.skipped} skipped, ${summary.errors} error(s)`,
  )
  lines.push('')
  lines.push('| file | status | converted | issues |')
  lines.push('| --- | --- | --- | --- |')

  for (const file of report.files) {
    const issues = file.diagnostics.filter((diagnostic) => severityOf(diagnostic.code) !== 'info').length
    lines.push(`| ${file.path} | ${file.status} | ${listed(file.converted)} | ${issues} |`)
  }

  for (const file of report.files) {
    if (file.diagnostics.length === 0) continue
    lines.push('')
    lines.push(`### ${file.path}`)

    for (const [code, group] of groupByCode(file.diagnostics)) {
      for (const diagnostic of group.slice(0, LISTED_PER_CODE)) {
        lines.push(`- \`${code}\` ${diagnostic.line}:${diagnostic.column} - ${diagnostic.message}`)
      }
      if (group.length > LISTED_PER_CODE) {
        lines.push(`- ... and ${group.length - LISTED_PER_CODE} more \`${code}\` in this file`)
      }
    }
  }

  return `${lines.join('\n')}\n`
}

/** A component can convert fifty declarations; the table lists the first few. */
function listed(names: string[]): string {
  if (names.length === 0) return '-'
  if (names.length <= LISTED_IN_TABLE) return names.join(', ')
  return `${names.slice(0, LISTED_IN_TABLE).join(', ')} (+${names.length - LISTED_IN_TABLE})`
}

/** A real component can produce hundreds of diagnostics; the report stays readable by grouping. */
function groupByCode(diagnostics: ReportFile['diagnostics']): Array<[string, ReportFile['diagnostics']]> {
  const groups = new Map<string, ReportFile['diagnostics']>()
  for (const diagnostic of diagnostics) {
    const group = groups.get(diagnostic.code)
    if (group) group.push(diagnostic)
    else groups.set(diagnostic.code, [diagnostic])
  }
  return [...groups.entries()]
}
