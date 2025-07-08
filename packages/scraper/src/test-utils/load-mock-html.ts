import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export function loadMockHtml(filename: string): string {
  const mockPath = join(process.cwd(), 'mocks', filename)
  return readFileSync(mockPath, 'utf-8')
}
