/**
 * 触发补货任务（使用 CRON_SECRET）
 *
 * 用法：
 *   node scripts/run-replenish-job.js
 */

const fs = require('fs')
const path = require('path')

function loadEnvFromFile() {
  const envPath = path.join(process.cwd(), '.env')
  if (!fs.existsSync(envPath)) return

  const content = fs.readFileSync(envPath, 'utf8')
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const index = trimmed.indexOf('=')
    if (index === -1) continue
    const key = trimmed.slice(0, index).trim()
    const rawValue = trimmed.slice(index + 1).trim()
    const value = rawValue.replace(/^['"]|['"]$/g, '')
    if (key && value) {
      process.env[key] = value
    }
  }
}

function parseArgs(argv) {
  const args = {}
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--mode') args.mode = argv[i + 1]
    if (arg === '--campaign-id') args.campaignId = argv[i + 1]
    if (arg === '--force') args.force = argv[i + 1]
  }
  return args
}

async function main() {
  loadEnvFromFile()
  const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:51001'
  const cronSecret = process.env.CRON_SECRET

  if (!cronSecret) {
    throw new Error('CRON_SECRET 未配置，无法调用补货任务')
  }

  const args = parseArgs(process.argv.slice(2))
  const mode = args.mode || 'all'
  const force = args.force === 'true' || args.force === true
  const body = { mode }
  if (mode === 'single') {
    if (!args.campaignId) {
      throw new Error('mode=single 时必须提供 --campaign-id')
    }
    body.campaignId = args.campaignId
    body.force = force
  } else if (mode === 'all') {
    body.force = force
  }

  // 设置 10 分钟超时，因为补货可能需要较长时间
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10 * 60 * 1000)

  try {
    const res = await fetch(`${apiBase}/api/v1/jobs/replenish`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Cron-Secret': cronSecret,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    clearTimeout(timeout)

    const text = await res.text()
    try {
      const json = JSON.parse(text)
      console.log(JSON.stringify({ status: res.status, body: json }, null, 2))
    } catch {
      console.log(`status=${res.status}`)
      console.log(text)
    }
  } catch (err) {
    clearTimeout(timeout)
    throw err
  }
}

main().catch(error => {
  console.error('[Error]', error.message || error)
  process.exit(1)
})
