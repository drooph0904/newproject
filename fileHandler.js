import fs from 'fs'
import path from 'path'

const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10MB
const ALLOWED_EXTENSIONS = ['.jmx', '.js', '.json', '.csv', '.xml', '.xlsx', '.zip']
const EXTENSION_LABELS = {
  '.jmx':  'JMeter Load Test Script',
  '.js':   'API Test Script',
  '.json': 'Test Data / Config',
  '.csv':  'Test Data',
  '.xml':  'Test Config / Suite',
  '.xlsx': 'Test Report / Sheet',
  '.zip':  'Test Archive',
}

export function detectInputType(input) {
  if (!input || !input.trim()) return 'unknown'
  const trimmed = input.trim()
  if (trimmed.startsWith('https://docs.google.com/spreadsheets')) return 'google-sheet'
  if (fs.existsSync(trimmed)) return 'file'
  return 'unknown'
}

export async function validateFile(filePath) {
  const trimmed = filePath.trim()
  if (!fs.existsSync(trimmed)) throw new Error(`File not found: ${trimmed}`)
  const stats = fs.statSync(trimmed)
  if (stats.size > MAX_FILE_SIZE) throw new Error(`File too large: ${(stats.size / 1024 / 1024).toFixed(1)}MB (max 10MB for Jira attachments)`)
  const ext = path.extname(trimmed).toLowerCase()
  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    console.warn(`⚠ Extension ${ext} is not in the common list — attaching anyway`)
  }
  return {
    filePath: trimmed,
    fileName: path.basename(trimmed),
    size: stats.size,
    ext,
  }
}

export function getFileTypeLabel(ext) {
  return EXTENSION_LABELS[ext?.toLowerCase()] || 'Attachment'
}
