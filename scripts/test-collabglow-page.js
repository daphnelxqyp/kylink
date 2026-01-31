/**
 * CollabGlow 单页原始响应测试脚本（纯 JS，无需 ts-node）
 *
 * 使用方法：
 *   CG_TOKEN=your_token node /Users/kyapple/Desktop/0114/scripts/test-collabglow-page.js --page 1 --page-size 50
 */

const API_URL = 'https://api.collabglow.com/api/monetization'
const TOKEN = process.env.CG_TOKEN

function getArgValue(flag, defaultValue) {
  const args = process.argv.slice(2)
  const index = args.indexOf(flag)
  if (index === -1) return defaultValue
  const value = args[index + 1]
  return value ? value : defaultValue
}

async function main() {
  if (!TOKEN) {
    console.error('❌ 缺少 CG_TOKEN，请先设置环境变量。')
    process.exit(1)
  }

  const page = Number(getArgValue('--page', '1')) || 1
  const pageSize = Number(getArgValue('--page-size', '50')) || 50
  const relationship = getArgValue('--relationship', 'Joined')

  const body = {
    source: 'collabglow',
    token: TOKEN,
    curPage: page,
    perPage: pageSize,
    relationship,
  }

  console.log('🚀 CollabGlow 单页原始响应测试')
  console.log('='.repeat(80))
  console.log(`API URL: ${API_URL}`)
  console.log(`Token: ${TOKEN.slice(0, 8)}...${TOKEN.slice(-4)}`)
  console.log(`参数: page=${page}, perPage=${pageSize}, relationship=${relationship}`)

  const response = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    console.error(`❌ HTTP 错误: ${response.status} ${response.statusText}`)
    process.exit(1)
  }

  const data = await response.json()
  console.log('\n' + '='.repeat(80))
  console.log(`🧾 原始响应（第 ${page} 页）`)
  console.log('='.repeat(80))
  console.log(JSON.stringify(data, null, 2))
}

main().catch(error => {
  console.error('❌ 执行失败:', error instanceof Error ? error.message : error)
  process.exit(1)
})

