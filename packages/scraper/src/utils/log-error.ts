import { appendFileSync } from 'node:fs'

export function logError(error: any, details: string) {
  const timestamp = new Date().toISOString()
  const logMessage = `[${timestamp}] ${details}\nError: ${
    error.message || error
  }\nStack: ${error.stack || 'N/A'}\n\n`
  try {
    appendFileSync('error.log', logMessage)
  } catch (writeError) {
    console.error('CRITICAL: Failed to write to error log file.', writeError)
    console.error('Original error was:', logMessage)
  }
}
