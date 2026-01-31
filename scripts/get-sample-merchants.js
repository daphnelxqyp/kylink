/**
 * 获取真实商家样本用于测试
 */
const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

async function main() {
  const userId = '9d58f58b-2f10-4a87-a94a-48e8633278fc'
  const networks = ['LH1', 'PM1', 'RW1', 'LB1']

  console.log('数据库中真实存在的商家样本:\n')

  for (const shortName of networks) {
    const network = await prisma.affiliateNetwork.findFirst({
      where: { userId, shortName, deletedAt: null },
    })

    if (!network) continue

    const merchants = await prisma.affiliateMerchant.findMany({
      where: { userId, networkId: network.id, deletedAt: null },
      take: 2,
      select: { mid: true, merchantName: true, domain: true },
    })

    console.log(shortName + ':')
    for (const m of merchants) {
      const safeName = (m.merchantName || '').substring(0, 10).replace(/[^a-zA-Z0-9]/g, '')
      const prefix = shortName.replace(/[0-9]+$/, '')
      const campaignName = `001-${shortName}-${safeName}-US-0121-${m.mid}`
      console.log(`  广告系列名: ${campaignName}`)
      console.log(`  解析结果: ${prefix} | mid=${m.mid}`)
      console.log(`  商家: ${m.merchantName}`)
      console.log('')
    }
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
