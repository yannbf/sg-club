import { existsSync, mkdirSync, copyFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const DATA_DIR = '../website/public/data'
const INVESTIGATION_DIR = '../website/investigation'

const FILES_TO_BACKUP = [
  { src: `${DATA_DIR}/group_users.json`, name: 'group_users.json' },
  { src: `${DATA_DIR}/giveaways.json`, name: 'giveaways.json' },
  { src: `${DATA_DIR}/user_entries.json`, name: 'user_entries.json' },
  { src: `${DATA_DIR}/ex_members.json`, name: 'ex_members.json' },
  { src: `${INVESTIGATION_DIR}/giveaway_leavers.json`, name: 'giveaway_leavers.json' },
]

export function backupData(): void {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const backupDir = `${DATA_DIR}/backup-${timestamp}`

  mkdirSync(backupDir, { recursive: true })
  console.log(`📦 Creating backup in ${backupDir}`)

  for (const file of FILES_TO_BACKUP) {
    if (existsSync(file.src)) {
      copyFileSync(file.src, `${backupDir}/${file.name}`)
      console.log(`  ✅ ${file.name}`)
    } else {
      console.log(`  ⚠️  ${file.name} not found, skipping`)
    }
  }

  console.log(`📦 Backup complete`)
}

if (import.meta.url.startsWith('file:')) {
  const modulePath = fileURLToPath(import.meta.url)
  if (process.argv[1] === modulePath) {
    backupData()
  }
}
