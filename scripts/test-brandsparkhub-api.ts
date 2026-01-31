/**
 * BrandSparkHub Monetization API 测试脚本
 * 
 * 功能：获取 BrandSparkHub 联盟的所有商家 tracking_url 和相关数据
 * 
 * 使用方法：
 *   npx ts-node scripts/test-brandsparkhub-api.ts
 * 
 * 或者设置环境变量后运行：
 *   BSH_TOKEN=your_token npx ts-node scripts/test-brandsparkhub-api.ts
 */

// ============================================
// 配置
// ============================================

const API_URL = 'https://api.brandsparkhub.com/api/monetization'

// API Token（可通过环境变量覆盖）
// 示例 token 来自用户提供的文档
const DEFAULT_TOKEN = 'eaa83affe57fa5a52470c3110a8f1bb2'
const TOKEN = process.env.BSH_TOKEN || DEFAULT_TOKEN

// ============================================
// 类型定义
// ============================================

// API 返回的是 snake_case 格式
interface MerchantInfo {
  mcid: string                    // 唯一标识符，如 "ulike0"
  mid: number                     // 已弃用，将来会移除
  brand_id: number                // 品牌 ID，如 66303
  merchant_name: string           // 品牌名称
  comm_rate: string               // 佣金率，如 "Rev. Share:65.00%"
  comm_detail?: string | null     // 佣金详情
  site_url: string                // 品牌首页 URL
  logo: string | null             // 品牌 Logo
  categories: string              // 品牌分类，如 "Health & Beauty>Bath & Body"
  tags?: string | null            // 子分类和关键词
  offer_type: string              // 定价模式，如 "CPS"
  network_partner?: string | null // 联盟网络
  avg_payment_cycle?: number      // 平均付款周期（天）
  avg_payout?: string             // 平均佣金率
  country: string                 // 国家代码，如 "US"
  support_region: string          // 支持地区，如 "US,PR"
  brand_status: string            // 品牌状态: "Online" | "Offline"
  merchant_status?: string        // 商家状态
  datetime: number                // 加入/移除时间戳
  relationship: string            // 关系状态: "Joined" 等
  tracking_url: string | null     // 追踪链接
  tracking_url_short?: string | null  // 短链接
  tracking_url_smart?: string | null  // 智能链接
  RD?: string | null              // Cookie 有效期（天）
  site_desc?: string              // 品牌描述
  filter_words?: string | null    // 过滤词
  currency_name: string | null    // 货币名称
  allow_sml: string               // 是否支持深链: "Y" | "N"
  post_area_list?: string[]       // 配送地区列表
  rep_name?: string | null        // 品牌联系人姓名
  rep_email?: string | null       // 品牌联系人邮箱
  support_couponordeal?: number | string  // 是否支持优惠券: "1" | "0" | "-"
  mlink_hash?: string
  brand_type?: string | null
  is_direct?: number
}

// API 响应格式
interface ApiResponse {
  code: string | number           // 响应状态码 (0 = 成功)
  message: string                 // 响应状态描述
  data: {
    total_mcid: number            // 总品牌数
    total_page: number            // 总页数
    limit: number                 // 每页数量
    list: MerchantInfo[]          // 品牌列表
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
 * @param country 国家筛选（可选，两位国家代码）
 * @param offerType 定价模式筛选（可选）
 * @param categories 分类筛选（可选，需 URL 编码）
 */
async function fetchMerchantDetails(
  curPage: number = 1,
  perPage: number = 1000,
  relationship?: string,
  country?: string,
  offerType?: string,
  categories?: string
): Promise<ApiResponse> {
  const requestBody: Record<string, string | number> = {
    source: 'brandsparkhub',      // BSH 必需的 source 参数
    token: TOKEN,
    curPage,
    perPage,
  }
  
  // 添加可选筛选参数
  if (relationship) {
    requestBody.relationship = relationship
  }
  if (country) {
    requestBody.country = country
  }
  if (offerType) {
    requestBody.offer_type = offerType
  }
  if (categories) {
    requestBody.categories = categories
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

  // 按分类统计（取主分类）
  const categoryStats = new Map<string, number>()
  merchants.forEach(m => {
    const category = (m.categories || 'Unknown').split('>')[0].trim()
    categoryStats.set(category, (categoryStats.get(category) || 0) + 1)
  })
  
  console.log('\n按主分类统计 (Top 10):')
  Array.from(categoryStats.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .forEach(([category, count]) => {
      console.log(`  ${category}: ${count} 个商家`)
    })

  // 支持深链统计
  const deeplinkSupport = merchants.filter(m => m.allow_sml === 'Y').length
  console.log(`\n支持深链: ${deeplinkSupport} 个 (${((deeplinkSupport / merchants.length) * 100).toFixed(1)}%)`)
  
  // 有 tracking_url 的商家统计
  const withTrackingUrl = merchants.filter(m => m.tracking_url).length
  console.log(`有追踪链接: ${withTrackingUrl} 个 (${((withTrackingUrl / merchants.length) * 100).toFixed(1)}%)`)

  // 支持优惠券的商家统计
  const supportCoupon = merchants.filter(m => String(m.support_couponordeal) === '1').length
  const notSupportCoupon = merchants.filter(m => String(m.support_couponordeal) === '0').length
  const unknownCoupon = merchants.length - supportCoupon - notSupportCoupon
  console.log(`\n优惠券支持:`)
  console.log(`  允许: ${supportCoupon} 个`)
  console.log(`  不允许: ${notSupportCoupon} 个`)
  console.log(`  未知: ${unknownCoupon} 个`)

  // 品牌状态统计
  const onlineCount = merchants.filter(m => m.brand_status === 'Online').length
  const offlineCount = merchants.filter(m => m.brand_status === 'Offline').length
  console.log(`\n品牌状态:`)
  console.log(`  在线: ${onlineCount} 个`)
  console.log(`  离线: ${offlineCount} 个`)
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
    console.log(`   支持地区: ${m.support_region}`)
    console.log(`   类型: ${m.offer_type}`)
    console.log(`   分类: ${m.categories}`)
    console.log(`   佣金: ${m.comm_rate}`)
    console.log(`   状态: ${m.brand_status}`)
    console.log(`   关系: ${m.relationship}`)
    console.log(`   深链: ${m.allow_sml}`)
    console.log(`   Cookie 有效期: ${m.RD || '(未知)'} 天`)
    console.log(`   平均付款周期: ${m.avg_payment_cycle || '(未知)'} 天`)
    console.log(`   网站: ${m.site_url}`)
    console.log(`   追踪链接: ${m.tracking_url || '(无)'}`)
    if (m.tracking_url_short) {
      console.log(`   短链接: ${m.tracking_url_short}`)
    }
    if (m.tracking_url_smart) {
      console.log(`   智能链接: ${m.tracking_url_smart}`)
    }
    if (m.site_desc) {
      const desc = m.site_desc.length > 100 ? m.site_desc.slice(0, 100) + '...' : m.site_desc
      console.log(`   描述: ${desc}`)
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
// 快速测试函数
// ============================================

/**
 * 快速测试 API 连接（只获取第一页少量数据）
 */
async function quickTest() {
  console.log('\n🔍 快速测试模式 - 只获取第一页前 10 条数据')
  
  const response = await fetchMerchantDetails(1, 10, 'Joined')
  
  const statusCode = String(response.code)
  if (statusCode !== '0') {
    throw new Error(`API 错误: ${response.message} (code: ${response.code})`)
  }

  console.log(`\n✅ API 连接成功！`)
  console.log(`   总商家数: ${response.data.total_mcid}`)
  console.log(`   总页数: ${response.data.total_page}`)
  console.log(`   本页数量: ${response.data.list.length}`)
  
  if (response.data.list.length > 0) {
    const firstMerchant = response.data.list[0]
    console.log(`\n   示例商家:`)
    console.log(`     名称: ${firstMerchant.merchant_name}`)
    console.log(`     MCID: ${firstMerchant.mcid}`)
    console.log(`     网站: ${firstMerchant.site_url}`)
    console.log(`     追踪链接: ${firstMerchant.tracking_url || '(无)'}`)
  }
  
  return response
}

// ============================================
// 主函数
// ============================================

async function main() {
  console.log('🚀 BrandSparkHub Monetization API 测试')
  console.log('='.repeat(80))
  console.log(`API URL: ${API_URL}`)
  console.log(`Token: ${TOKEN.slice(0, 8)}...${TOKEN.slice(-4)}`)
  console.log(`筛选条件: relationship=Joined`)

  // 检查命令行参数
  const args = process.argv.slice(2)
  const isQuickTest = args.includes('--quick') || args.includes('-q')
  const isFullExport = args.includes('--export') || args.includes('-e')

  try {
    if (isQuickTest) {
      // 快速测试模式
      await quickTest()
      console.log('\n✅ 快速测试完成！')
      console.log('\n💡 提示: 运行 `npx ts-node scripts/test-brandsparkhub-api.ts --export` 获取全部数据')
    } else {
      // 完整获取模式
      console.log('\n🚀 运行并发分页请求...')
      const startTime = Date.now()
      const merchants = await fetchAllJoinedMerchantsFast()
      const duration = Date.now() - startTime
      console.log(`\n⏱️  总耗时: ${formatDuration(duration)}`)

      // 打印摘要
      printMerchantSummary(merchants)

      // 打印详细列表（前 10 条）
      printMerchantList(merchants, 10)

      // 是否导出
      if (isFullExport || merchants.length > 0) {
        await exportToJson(merchants, 'brandsparkhub-merchants.json')
      }

      console.log('\n✅ 测试完成！')
    }

  } catch (error) {
    console.error('\n❌ 错误:', error instanceof Error ? error.message : error)
    process.exit(1)
  }
}

// 运行主函数
main()

