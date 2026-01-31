/**
 * 补货性能测试脚本
 * 
 * 测试生成指定数量的 suffix 需要多长时间
 * 
 * 用法：
 *   node scripts/benchmark-replenish.js --count 1000
 *   node scripts/benchmark-replenish.js --count 100 --concurrency 10
 */

const fs = require('fs')
const path = require('path')

// 加载环境变量
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
  const args = { count: 100 }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--count') args.count = parseInt(argv[i + 1], 10) || 100
    if (argv[i] === '--stock-concurrency') args.stockConcurrency = parseInt(argv[i + 1], 10)
    if (argv[i] === '--campaign-concurrency') args.campaignConcurrency = parseInt(argv[i + 1], 10)
  }
  return args
}

async function main() {
  loadEnvFromFile()
  
  const args = parseArgs(process.argv.slice(2))
  const targetCount = args.count
  
  // 覆盖并发配置（如果指定）
  if (args.stockConcurrency) {
    process.env.STOCK_CONCURRENCY = String(args.stockConcurrency)
  }
  if (args.campaignConcurrency) {
    process.env.CAMPAIGN_CONCURRENCY = String(args.campaignConcurrency)
  }

  const stockConcurrency = parseInt(process.env.STOCK_CONCURRENCY || '5', 10)
  const campaignConcurrency = parseInt(process.env.CAMPAIGN_CONCURRENCY || '3', 10)
  
  console.log('==========================================')
  console.log('        补货性能测试 (Benchmark)')
  console.log('==========================================')
  console.log(`目标生成数量: ${targetCount} 条`)
  console.log(`STOCK_CONCURRENCY: ${stockConcurrency}`)
  console.log(`CAMPAIGN_CONCURRENCY: ${campaignConcurrency}`)
  console.log(`总并发数: ${stockConcurrency * campaignConcurrency}`)
  console.log('------------------------------------------')

  const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:51001'
  const cronSecret = process.env.CRON_SECRET

  if (!cronSecret) {
    throw new Error('CRON_SECRET 未配置')
  }

  // 计算需要多少轮补货
  // 假设有 9 个 Campaign，默认每个补 10 条
  const batchSize = parseInt(process.env.SUFFIX_PRODUCE_BATCH_SIZE || '10', 10)
  const campaignsPerRound = 9 // 假设有 9 个 Campaign
  const suffixPerRound = campaignsPerRound * batchSize
  const rounds = Math.ceil(targetCount / suffixPerRound)
  
  console.log(`每轮补货: ${suffixPerRound} 条 (${campaignsPerRound} campaigns × ${batchSize} items)`)
  console.log(`需要轮数: ${rounds}`)
  console.log('------------------------------------------')

  const startTime = Date.now()
  let totalGenerated = 0
  let totalRealIp = 0
  let totalMockIp = 0

  for (let round = 1; round <= rounds && totalGenerated < targetCount; round++) {
    const roundStart = Date.now()
    console.log(`\n[轮次 ${round}/${rounds}] 开始补货...`)

    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 10 * 60 * 1000)

      const res = await fetch(`${apiBase}/api/v1/jobs/replenish`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Cron-Secret': cronSecret,
        },
        body: JSON.stringify({ mode: 'all', force: true }),
        signal: controller.signal,
      })

      clearTimeout(timeout)

      if (!res.ok) {
        console.error(`  HTTP ${res.status}`)
        continue
      }

      const data = await res.json()
      
      if (data.success && data.details) {
        let roundGenerated = 0
        for (const detail of data.details) {
          roundGenerated += detail.producedCount || 0
        }
        totalGenerated += roundGenerated

        const roundElapsed = Date.now() - roundStart
        console.log(`  ✓ 生成 ${roundGenerated} 条, 耗时 ${(roundElapsed / 1000).toFixed(1)}s`)
      }

    } catch (err) {
      console.error(`  ✗ 错误: ${err.message}`)
    }
  }

  const totalElapsed = Date.now() - startTime
  const avgPerItem = totalGenerated > 0 ? totalElapsed / totalGenerated : 0

  console.log('\n==========================================')
  console.log('              测试结果')
  console.log('==========================================')
  console.log(`总生成数量: ${totalGenerated} 条`)
  console.log(`总耗时: ${(totalElapsed / 1000).toFixed(1)} 秒`)
  console.log(`平均每条: ${avgPerItem.toFixed(0)} ms`)
  console.log(`吞吐量: ${(totalGenerated / (totalElapsed / 1000)).toFixed(1)} 条/秒`)
  console.log('------------------------------------------')
  console.log(`并发配置: STOCK=${stockConcurrency}, CAMPAIGN=${campaignConcurrency}`)
  
  // 估算 1000 条耗时
  const est1000 = (1000 / totalGenerated) * totalElapsed / 1000
  console.log(`\n预估 1000 条耗时: ${est1000.toFixed(1)} 秒 (${(est1000 / 60).toFixed(1)} 分钟)`)
  console.log('==========================================')
}

main().catch(err => {
  console.error('[Error]', err.message || err)
  process.exit(1)
})
