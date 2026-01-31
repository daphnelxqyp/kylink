/**
 * 直接调用补货函数（绕过 HTTP 超时）
 *
 * 用法：
 *   node scripts/run-replenish-direct.js
 *   node scripts/run-replenish-direct.js --user-id <USER_ID> --campaign-id <CAMPAIGN_ID>
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
    if (arg === '--user-id') args.userId = argv[i + 1]
    if (arg === '--campaign-id') args.campaignId = argv[i + 1]
  }
  return args
}

async function main() {
  loadEnvFromFile()

  // 动态导入 TypeScript 模块（需要 ts-node 或已编译）
  // 这里直接用 require 调用已编译的模块
  const { replenishCampaign, replenishAllLowStock } = require('../src/lib/stock-producer')

  const args = parseArgs(process.argv.slice(2))

  if (args.userId && args.campaignId) {
    // 单个 campaign 补货
    console.log(`[Replenish] 开始补货单个 Campaign: ${args.campaignId}`)
    const result = await replenishCampaign(args.userId, args.campaignId, true)
    console.log(JSON.stringify(result, null, 2))
  } else {
    // 全量补货
    console.log('[Replenish] 开始全量补货...')
    const result = await replenishAllLowStock()
    console.log(JSON.stringify(result, null, 2))
  }
}

main().catch(error => {
  console.error('[Error]', error.message || error)
  process.exit(1)
})
