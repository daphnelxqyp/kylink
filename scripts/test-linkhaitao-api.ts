/**
 * LinkHaitao MerchantBasicList API 测试脚本
 * 
 * 功能：获取 LinkHaitao 联盟的所有商家 tracking_url 和相关数据
 * 
 * 使用方法：
 *   npx ts-node scripts/test-linkhaitao-api.ts
 * 
 * 或者设置环境变量后运行：
 *   LH_TOKEN=your_token npx ts-node scripts/test-linkhaitao-api.ts
 */

// ============================================
// 配置
// ============================================

const API_URL = 'https://www.linkhaitao.com/api.php?mod=medium&op=merchantBasicList3'

// API Token（可通过环境变量覆盖）
// 示例 token 来自用户提供的文档
const DEFAULT_TOKEN = 'pC0qBo4fQZ6qdqeD'
const TOKEN = process.env.LH_TOKEN || DEFAULT_TOKEN

// ============================================
// 类型定义
// ============================================

interface MerchantInfo {
  mcid: string
  m_id: string              // LH 使用 m_id 而不是 mid
  merchant_name: string
  comm_rate: string
  site_url: string
  logo: string
  categories: string
  offer_type: string
  country: string
  monthly_visits: string
  merchant_status: string
  datetime: string
  relationship: string
  tracking_url: string
  tracking_url_short: string
  RD: string
  site_desc: string
  restricted_keywords: string
  currency: string
  support_region: string
  support_deeplink: string
  approval_mode: string
  traffic_promotion_type: string
  promotion_area: string
}

interface ApiResponse {
  status: {
    code: number
    msg: string
  }
  data: {
    per_page: number
    list: MerchantInfo[]
    total_count?: string | number
    total_page: number
  }
}

// ============================================
// API 调用函数
// ============================================

/**
 * 获取联盟商家详情
 * @param page 页码
 * @param perPage 每页数量 (min: 100, max: 40000)
 * @param merchantStatus 商家状态: 0-offline, 1-online
 */
async function fetchMerchantDetails(
  page: number = 1,
  perPage: number = 1000,
  merchantStatus: string = '1'
): Promise<ApiResponse> {
  const params = new URLSearchParams({
    token: TOKEN,
    page: String(page),
    per_page: String(perPage),
    merchant_status: merchantStatus,
  })

  console.log(`\n📡 正在请求第 ${page} 页数据...`)

  const response = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  })

  if (!response.ok) {
    throw new Error(`HTTP 错误: ${response.status} ${response.statusText}`)
  }

  const data = await response.json() as ApiResponse
  return data
}

/**
 * 获取所有在线商家（串行分页 - 旧方案）
 */
async function fetchAllMerchantsSlow(): Promise<MerchantInfo[]> {
  const allMerchants: MerchantInfo[] = []
  let currentPage = 1
  let totalPages = 1

  do {
    const response = await fetchMerchantDetails(currentPage, 1000)

    // 检查响应状态
    if (response.status.code !== 0) {
      throw new Error(`API 错误: ${response.status.msg} (code: ${response.status.code})`)
    }

    // 更新总页数
    totalPages = response.data.total_page
    const merchants = response.data.list || []
    
    console.log(`✅ 第 ${currentPage}/${totalPages} 页完成，获取 ${merchants.length} 条数据`)
    
    allMerchants.push(...merchants)
    currentPage++

    // 添加延迟，避免请求过快
    if (currentPage <= totalPages) {
      await new Promise(resolve => setTimeout(resolve, 500))
    }

  } while (currentPage <= totalPages)

  return allMerchants
}

/**
 * 获取所有在线商家（并发分页 - 优化版）
 */
async function fetchAllMerchantsFast(): Promise<MerchantInfo[]> {
  // 1. 先获取第一页，拿到总页数
  const firstPage = await fetchMerchantDetails(1, 1000)
  if (firstPage.status.code !== 0) {
    throw new Error(`API 错误: ${firstPage.status.msg}`)
  }

  const totalPages = firstPage.data.total_page
  const totalCount = firstPage.data.total_count || 'N/A'
  const allMerchants: MerchantInfo[] = [...(firstPage.data.list || [])]
  
  console.log(`📊 总页数: ${totalPages}，总商家数: ${totalCount}`)
  console.log(`✅ 第 1/${totalPages} 页完成，获取 ${firstPage.data.list?.length || 0} 条数据`)

  if (totalPages > 1) {
    // 2. 并发请求剩余所有页面（控制并发数避免被限流）
    const CONCURRENCY = 5 // 并发数
    const remainingPages = Array.from({ length: totalPages - 1 }, (_, i) => i + 2)
    
    for (let i = 0; i < remainingPages.length; i += CONCURRENCY) {
      const batch = remainingPages.slice(i, i + CONCURRENCY)
      const batchStart = Date.now()
      
      const results = await Promise.all(
        batch.map(page => fetchMerchantDetails(page, 1000))
      )
      
      let batchCount = 0
      results.forEach((r, idx) => {
        if (r.status.code === 0 && r.data.list) {
          allMerchants.push(...r.data.list)
          batchCount += r.data.list.length
        } else {
          console.log(`⚠️ 第 ${batch[idx]} 页获取失败: ${r.status.msg}`)
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
  console.log('📊 商家数据摘要 (LinkHaitao)')
  console.log('='.repeat(80))
  
  console.log(`\n总商家数: ${merchants.length}`)

  // 按国家统计
  const countryStats = new Map<string, number>()
  merchants.forEach(m => {
    const country = m.country || 'Unknown'
    countryStats.set(country, (countryStats.get(country) || 0) + 1)
  })
  
  console.log('\n按国家统计:')
  Array.from(countryStats.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .forEach(([country, count]) => {
      console.log(`  ${country}: ${count} 个商家`)
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

  // 按关系统计
  const relationshipStats = new Map<string, number>()
  merchants.forEach(m => {
    const rel = m.relationship || 'Unknown'
    relationshipStats.set(rel, (relationshipStats.get(rel) || 0) + 1)
  })
  
  console.log('\n按关系统计:')
  Array.from(relationshipStats.entries())
    .sort((a, b) => b[1] - a[1])
    .forEach(([rel, count]) => {
      console.log(`  ${rel}: ${count} 个商家`)
    })

  // 支持深链统计
  const deeplinkSupport = merchants.filter(m => m.support_deeplink === 'Y').length
  console.log(`\n支持深链: ${deeplinkSupport} 个 (${((deeplinkSupport / merchants.length) * 100).toFixed(1)}%)`)
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
    console.log(`   M_ID: ${m.m_id}`)
    console.log(`   国家: ${m.country}`)
    console.log(`   类型: ${m.offer_type}`)
    console.log(`   佣金: ${m.comm_rate}`)
    console.log(`   状态: ${m.merchant_status}`)
    console.log(`   关系: ${m.relationship}`)
    console.log(`   深链: ${m.support_deeplink}`)
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
  console.log('🚀 LinkHaitao MerchantBasicList API 测试')
  console.log('='.repeat(80))
  console.log(`API URL: ${API_URL}`)
  console.log(`Token: ${TOKEN.slice(0, 8)}...${TOKEN.slice(-4)}`)
  console.log(`筛选条件: merchant_status=1 (在线商家)`)

  // 获取命令行参数，决定运行模式
  const args = process.argv.slice(2)
  const runBoth = args.includes('--compare') // 对比模式
  const runSlow = args.includes('--slow')    // 仅运行慢速版本

  try {
    let merchants: MerchantInfo[] = []

    if (runBoth) {
      // ========== 对比模式：运行两个版本 ==========
      console.log('\n' + '='.repeat(80))
      console.log('📊 性能对比模式')
      console.log('='.repeat(80))

      // 先运行快速版本
      console.log('\n🚀 【方案1】并发分页请求（CONCURRENCY=5）')
      console.log('-'.repeat(40))
      const fastStart = Date.now()
      const fastMerchants = await fetchAllMerchantsFast()
      const fastDuration = Date.now() - fastStart
      console.log(`⏱️  耗时: ${formatDuration(fastDuration)}`)
      console.log(`📦 获取: ${fastMerchants.length} 条数据`)

      // 再运行慢速版本
      console.log('\n🐢 【旧方案】串行分页请求（每页间隔500ms）')
      console.log('-'.repeat(40))
      const slowStart = Date.now()
      const slowMerchants = await fetchAllMerchantsSlow()
      const slowDuration = Date.now() - slowStart
      console.log(`⏱️  耗时: ${formatDuration(slowDuration)}`)
      console.log(`📦 获取: ${slowMerchants.length} 条数据`)

      // 性能对比
      console.log('\n' + '='.repeat(80))
      console.log('📈 性能对比结果')
      console.log('='.repeat(80))
      console.log(`旧方案耗时: ${formatDuration(slowDuration)}`)
      console.log(`方案1耗时:  ${formatDuration(fastDuration)}`)
      const speedup = (slowDuration / fastDuration).toFixed(2)
      console.log(`🎉 性能提升: ${speedup}x 倍！`)
      console.log(`节省时间: ${formatDuration(slowDuration - fastDuration)}`)

      merchants = fastMerchants

    } else if (runSlow) {
      // ========== 仅运行慢速版本 ==========
      console.log('\n🐢 运行串行分页请求...')
      const startTime = Date.now()
      merchants = await fetchAllMerchantsSlow()
      const duration = Date.now() - startTime
      console.log(`\n⏱️  总耗时: ${formatDuration(duration)}`)

    } else {
      // ========== 默认：仅运行快速版本 ==========
      console.log('\n🚀 运行并发分页请求（方案1）...')
      const startTime = Date.now()
      merchants = await fetchAllMerchantsFast()
      const duration = Date.now() - startTime
      console.log(`\n⏱️  总耗时: ${formatDuration(duration)}`)
    }

    // 打印摘要
    printMerchantSummary(merchants)

    // 打印详细列表（前 10 条）
    printMerchantList(merchants, 10)

    // 导出到 JSON 文件
    await exportToJson(merchants, 'linkhaitao-merchants.json')

    console.log('\n✅ 测试完成！')
    console.log('\n💡 提示:')
    console.log('   --compare  对比新旧方案性能')
    console.log('   --slow     使用旧方案（串行请求）')

  } catch (error) {
    console.error('\n❌ 错误:', error instanceof Error ? error.message : error)
    process.exit(1)
  }
}

// 运行主函数
main()

