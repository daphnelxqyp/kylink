/**
 * CollabGlow Monetization API 测试脚本
 * 
 * 功能：获取 CollabGlow 联盟的所有商家 tracking_url 和相关数据
 * 
 * 使用方法：
 *   npx ts-node scripts/test-collabglow-api.ts
 * 
 * 或者设置环境变量后运行：
 *   CG_TOKEN=your_token npx ts-node scripts/test-collabglow-api.ts
 */

// ============================================
// 配置
// ============================================

const API_URL = 'https://api.collabglow.com/api/monetization'

// API Token（可通过环境变量覆盖）
// 示例 token 来自用户提供的文档
const DEFAULT_TOKEN = '7689ab25bb97f126fe52cf71306dbb45'
const TOKEN = process.env.CG_TOKEN || DEFAULT_TOKEN

// ============================================
// 类型定义
// ============================================

// API 返回的是 snake_case 格式
interface MerchantInfo {
  mcid: string
  mid: number               // 已弃用，使用 mcid
  brand_id: number
  merchant_name: string
  comm_rate: string
  comm_detail?: string | null
  site_url: string
  logo: string | null
  categories: string
  tags?: string | null
  offer_type: string
  network_partner?: string | null
  avg_payment_cycle?: number
  avg_payout?: string
  country: string
  support_region: string
  brand_status: string
  merchant_status?: string
  datetime: number
  relationship: string
  tracking_url: string | null
  tracking_url_short?: string | null
  RD?: string | null
  site_desc?: string
  filter_words?: string | null
  currency_name: string | null
  allow_sml: string
  post_area_list?: string[]
  rep_name?: string | null
  rep_email?: string | null
  support_couponordeal?: number | string
  mlink_hash?: string
  brand_type?: string | null
  is_direct?: number
}

// API 响应格式
interface ApiResponse {
  code: string | number
  message: string
  data: {
    total_mcid: number
    total_page: number
    limit: number
    list: MerchantInfo[]
  }
}

// ============================================
// API 调用函数
// ============================================

/**
 * 获取联盟商家详情
 * @param curPage 当前页码
 * @param perPage 每页数量 (max: 2000)
 * @param relationship 商家关系筛选（可选）
 */
async function fetchMerchantDetails(
  curPage: number = 1,
  perPage: number = 1000,
  relationship?: string
): Promise<ApiResponse> {
  const requestBody: Record<string, string | number> = {
    source: 'collabglow',
    token: TOKEN,
    curPage,
    perPage,
  }
  
  if (relationship) {
    requestBody.relationship = relationship
  }

  console.log(`\n📡 正在请求第 ${curPage} 页数据...`)

  const response = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(requestBody),
  })

  if (!response.ok) {
    throw new Error(`HTTP 错误: ${response.status} ${response.statusText}`)
  }

  const data = await response.json() as ApiResponse
  return data
}

/**
 * 获取所有已加入联盟的商家（并发分页）
 */
async function fetchAllJoinedMerchantsFast(): Promise<MerchantInfo[]> {
  // 1. 先获取第一页，拿到总页数
  const firstPage = await fetchMerchantDetails(1, 1000, 'Joined')
  
  // 检查响应状态
  const statusCode = String(firstPage.code)
  if (statusCode !== '0') {
    throw new Error(`API 错误: ${firstPage.message} (code: ${firstPage.code})`)
  }

  const totalPages = firstPage.data.total_page
  const allMerchants: MerchantInfo[] = [...(firstPage.data.list || [])]
  
  console.log(`📊 总页数: ${totalPages}，总商家数: ${firstPage.data.total_mcid}`)
  console.log(`✅ 第 1/${totalPages} 页完成，获取 ${firstPage.data.list?.length || 0} 条数据`)

  if (totalPages > 1) {
    // 2. 并发请求剩余所有页面（控制并发数避免被限流）
    const CONCURRENCY = 3  // 并发数
    const remainingPages = Array.from({ length: totalPages - 1 }, (_, i) => i + 2)
    
    for (let i = 0; i < remainingPages.length; i += CONCURRENCY) {
      const batch = remainingPages.slice(i, i + CONCURRENCY)
      const batchStart = Date.now()
      
      const results = await Promise.all(
        batch.map(page => fetchMerchantDetails(page, 1000, 'Joined'))
      )
      
      let batchCount = 0
      results.forEach((r, idx) => {
        const code = String(r.code)
        if (code === '0' && r.data.list) {
          allMerchants.push(...r.data.list)
          batchCount += r.data.list.length
        } else {
          console.log(`⚠️ 第 ${batch[idx]} 页获取失败: ${r.message}`)
        }
      })
      
      const batchTime = Date.now() - batchStart
      const completedPages = Math.min(i + CONCURRENCY, remainingPages.length) + 1
      console.log(`✅ 完成 ${completedPages}/${totalPages} 页，本批获取 ${batchCount} 条 (${batchTime}ms)`)
    }
  }

  return allMerchants
}

// ============================================
// 数据展示函数
// ============================================

/**
 * 打印商家摘要信息
 */
function printMerchantSummary(merchants: MerchantInfo[]) {
  console.log('\n' + '='.repeat(80))
  console.log('📊 商家数据摘要')
  console.log('='.repeat(80))
  
  console.log(`\n总商家数: ${merchants.length}`)

  // 按地区统计
  const regionStats = new Map<string, number>()
  merchants.forEach(m => {
    const region = m.country || 'Unknown'
    regionStats.set(region, (regionStats.get(region) || 0) + 1)
  })
  
  console.log('\n按地区统计:')
  Array.from(regionStats.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .forEach(([region, count]) => {
      console.log(`  ${region}: ${count} 个商家`)
    })

  // 按类型统计
  const typeStats = new Map<string, number>()
  merchants.forEach(m => {
    const type = m.offer_type || 'Unknown'
    typeStats.set(type, (typeStats.get(type) || 0) + 1)
  })
  
  console.log('\n按类型统计:')
  Array.from(typeStats.entries())
    .sort((a, b) => b[1] - a[1])
    .forEach(([type, count]) => {
      console.log(`  ${type}: ${count} 个商家`)
    })

  // 支持深链统计
  const deeplinkSupport = merchants.filter(m => m.allow_sml === 'Y').length
  console.log(`\n支持深链: ${deeplinkSupport} 个 (${((deeplinkSupport / merchants.length) * 100).toFixed(1)}%)`)
  
  // 有 tracking_url 的商家统计
  const withTrackingUrl = merchants.filter(m => m.tracking_url).length
  console.log(`有追踪链接: ${withTrackingUrl} 个 (${((withTrackingUrl / merchants.length) * 100).toFixed(1)}%)`)
}

/**
 * 打印商家详细列表（前 N 条）
 */
function printMerchantList(merchants: MerchantInfo[], limit: number = 20) {
  console.log('\n' + '='.repeat(80))
  console.log(`📋 商家列表（前 ${limit} 条）`)
  console.log('='.repeat(80))

  merchants.slice(0, limit).forEach((m, index) => {
    console.log(`\n${index + 1}. ${m.merchant_name}`)
    console.log(`   MCID: ${m.mcid}`)
    console.log(`   Brand ID: ${m.brand_id}`)
    console.log(`   地区: ${m.country}`)
    console.log(`   类型: ${m.offer_type}`)
    console.log(`   佣金: ${m.comm_rate}`)
    console.log(`   状态: ${m.brand_status}`)
    console.log(`   深链: ${m.allow_sml}`)
    console.log(`   网站: ${m.site_url}`)
    console.log(`   追踪链接: ${m.tracking_url || '(无)'}`)
    if (m.tracking_url_short) {
      console.log(`   短链接: ${m.tracking_url_short}`)
    }
  })
}

/**
 * 导出为 JSON 文件
 */
async function exportToJson(merchants: MerchantInfo[], filename: string) {
  const fs = await import('fs/promises')
  const path = await import('path')
  
  const outputPath = path.join(process.cwd(), filename)
  await fs.writeFile(outputPath, JSON.stringify(merchants, null, 2), 'utf-8')
  console.log(`\n💾 数据已导出到: ${outputPath}`)
}

/**
 * 导出为 CSV（便于手动查询 mid）
 * 说明：此 CSV 仅用于人工查找，mid 的真实来源以原始响应为准
 */
async function exportMidLookupCsv(merchants: MerchantInfo[], filename: string) {
  const fs = await import('fs/promises')
  const path = await import('path')

  const escapeCsvValue = (value: string | number | null | undefined) => {
    const str = String(value ?? '')
    const shouldQuote = /[",\n]/.test(str)
    const escaped = str.replace(/"/g, '""')
    return shouldQuote ? `"${escaped}"` : escaped
  }

  const headers = ['merchant_name', 'mid', 'mcid', 'site_url', 'tracking_url']
  const rows = merchants.map(m => ([
    escapeCsvValue(m.merchant_name),
    escapeCsvValue(m.mcid), // mid = mcid
    escapeCsvValue(m.mcid),
    escapeCsvValue(m.site_url),
    escapeCsvValue(m.tracking_url || ''),
  ].join(',')))

  const csvContent = [headers.join(','), ...rows].join('\n')
  const outputPath = path.join(process.cwd(), filename)
  await fs.writeFile(outputPath, csvContent, 'utf-8')
  console.log(`\n📄 mid 查询表已导出到: ${outputPath}`)
}

/**
 * 输出单页原始响应（便于人工核对字段）
 */
function printRawPageResponse(page: number, response: ApiResponse) {
  console.log('\n' + '='.repeat(80))
  console.log(`🧾 原始响应（第 ${page} 页）`)
  console.log('='.repeat(80))
  console.log(JSON.stringify(response, null, 2))
}

// ============================================
// 计时工具
// ============================================

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(2)}s`
  const minutes = Math.floor(ms / 60000)
  const seconds = ((ms % 60000) / 1000).toFixed(1)
  return `${minutes}m ${seconds}s`
}

// ============================================
// 主函数
// ============================================

async function main() {
  console.log('🚀 CollabGlow Monetization API 测试')
  console.log('='.repeat(80))
  console.log(`API URL: ${API_URL}`)
  console.log(`Token: ${TOKEN.slice(0, 8)}...${TOKEN.slice(-4)}`)
  console.log(`筛选条件: relationship=Joined`)

  try {
    const args = process.argv.slice(2)
    const exportLookup = args.includes('--lookup')
    const onePageMode = args.includes('--page')
    const pageIndex = onePageMode ? Number(args[args.indexOf('--page') + 1]) || 1 : 1
    const pageSize = args.includes('--page-size')
      ? Number(args[args.indexOf('--page-size') + 1]) || 100
      : 1000

    if (onePageMode) {
      console.log(`\n🔎 单页模式：第 ${pageIndex} 页，perPage=${pageSize}`)
      const pageData = await fetchMerchantDetails(pageIndex, pageSize, 'Joined')
      const code = String(pageData.code)
      if (code !== '0') {
        throw new Error(`API 错误: ${pageData.message} (code: ${pageData.code})`)
      }
      printRawPageResponse(pageIndex, pageData)
      console.log('\n✅ 单页输出完成！')
      return
    }

    console.log('\n🚀 运行并发分页请求...')
    const startTime = Date.now()
    const merchants = await fetchAllJoinedMerchantsFast()
    const duration = Date.now() - startTime
    console.log(`\n⏱️  总耗时: ${formatDuration(duration)}`)

    if (!exportLookup) {
    // 打印摘要
    printMerchantSummary(merchants)

    // 打印详细列表（前 10 条）
    printMerchantList(merchants, 10)

    // 导出到 JSON 文件
    await exportToJson(merchants, 'collabglow-merchants.json')
    }

    // 导出 mid 查询 CSV（无论是否只输出，都生成）
    await exportMidLookupCsv(merchants, 'collabglow-mid-lookup.csv')

    console.log('\n✅ 测试完成！')
    console.log('\n💡 提示:')
    console.log('   --lookup   仅生成 mid 查询 CSV（不打印摘要/列表）')
    console.log('   --page 1 --page-size 50   仅输出第 1 页原始响应')

  } catch (error) {
    console.error('\n❌ 错误:', error instanceof Error ? error.message : error)
    process.exit(1)
  }
}

// 运行主函数
main()

