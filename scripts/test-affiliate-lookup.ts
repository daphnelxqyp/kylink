/**
 * 本地测试脚本：联盟链接查询 API
 *
 * 使用方法：
 * 1. 启动开发服务器：npm run dev
 * 2. 运行测试：npx ts-node scripts/test-affiliate-lookup.ts
 *
 * 或者使用 curl 直接测试
 */

// 模拟广告系列名称解析逻辑（与 Google Ads 脚本中的逻辑一致）
function parseCampaignName(campaignName: string): {
  networkShortName: string
  mid: string
  parsed: boolean
} {
  if (!campaignName) {
    return { networkShortName: '', mid: '', parsed: false }
  }

  const parts = campaignName.split('-')

  if (parts.length < 3) {
    return { networkShortName: '', mid: '', parsed: false }
  }

  // 从第2个部分提取联盟简称（去除数字后缀）
  const networkPart = parts[1].trim().toUpperCase()
  const networkShortName = networkPart.replace(/[0-9]+$/, '')

  const mid = parts[parts.length - 1].trim()

  const validNetworks = ['RW', 'LH', 'PM', 'LB', 'CG', 'CF', 'BSH']
  const isValidNetwork = validNetworks.includes(networkShortName)
  const isValidMid = mid.length > 0 && /^[a-zA-Z0-9]+$/.test(mid)

  if (!isValidNetwork || !isValidMid) {
    return { networkShortName: '', mid: '', parsed: false }
  }

  return { networkShortName, mid, parsed: true }
}

// 测试广告系列名称解析
function testParsing() {
  console.log('\n===== 测试广告系列名称解析 =====\n')

  const testCases = [
    '688-LH1-viagogo-US-1216-38171',
    '346-PM1-blindsdirect-US-1216-87660',
    '343-PM1-eventbrite-US-1215-18645429',
    '260-PM1-twojemeble-PL-1104-53088',
    '154-LB1-colipays-FR-1229-91135',
    '082-RW1-katthelabel-AU-0115-122314',
  ]

  for (const name of testCases) {
    const result = parseCampaignName(name)
    const status = result.parsed ? '✅' : '❌'
    console.log(`${status} "${name}"`)
    console.log(`   -> networkShortName: ${result.networkShortName || '(空)'}`)
    console.log(`   -> mid: ${result.mid || '(空)'}`)
    console.log('')
  }
}

// 测试 API 调用
async function testApiCall() {
  console.log('\n===== 测试 API 调用 =====\n')

  // 配置
  const API_BASE_URL = 'http://localhost:3000'
  const API_KEY = 'ky_live_test_key' // 替换为实际的 API Key

  // 构建测试数据
  const campaignNames = [
    '688-LH1-viagogo-US-1216-38171',
    '346-PM1-blindsdirect-US-1216-87660',
    '082-RW1-katthelabel-AU-0115-122314',
  ]

  const campaigns = campaignNames.map((name, index) => {
    const parsed = parseCampaignName(name)
    return {
      campaignId: `test-${index + 1}`,
      networkShortName: parsed.networkShortName,
      mid: parsed.mid,
      finalUrl: 'https://example.com', // 备用
    }
  })

  console.log('请求数据:')
  console.log(JSON.stringify({ campaigns }, null, 2))
  console.log('')

  try {
    const response = await fetch(`${API_BASE_URL}/api/v1/affiliate-links/lookup`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${API_KEY}`,
        'X-Api-Key': API_KEY,
      },
      body: JSON.stringify({ campaigns }),
    })

    const data = await response.json()

    console.log(`响应状态: ${response.status}`)
    console.log('响应数据:')
    console.log(JSON.stringify(data, null, 2))
  } catch (error) {
    console.error('请求失败:', error)
  }
}

// 主函数
async function main() {
  // 1. 测试解析逻辑
  testParsing()

  // 2. 测试 API（需要先启动 dev server）
  const args = process.argv.slice(2)
  if (args.includes('--api')) {
    await testApiCall()
  } else {
    console.log('\n提示: 添加 --api 参数可测试 API 调用')
    console.log('例如: npx ts-node scripts/test-affiliate-lookup.ts --api')
    console.log('')
    console.log('或使用 curl 测试:')
    console.log(`
curl -X POST http://localhost:3000/api/v1/affiliate-links/lookup \\
  -H "Content-Type: application/json" \\
  -H "X-Api-Key: YOUR_API_KEY" \\
  -d '{
    "campaigns": [
      {"campaignId": "test-1", "networkShortName": "LH", "mid": "38171"},
      {"campaignId": "test-2", "networkShortName": "PM", "mid": "87660"},
      {"campaignId": "test-3", "networkShortName": "RW", "mid": "122314"}
    ]
  }'
`)
  }
}

main().catch(console.error)
