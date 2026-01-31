/**
 * 创建测试联盟数据脚本
 *
 * 运行方式: npx ts-node --compiler-options '{"module":"commonjs"}' scripts/seed-affiliate-data.ts
 */

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  // 获取测试用户
  const user = await prisma.user.findFirst({
    where: {
      email: 'test@kyads.com',
      deletedAt: null,
    },
  })

  if (!user) {
    console.log('❌ 测试用户不存在，请先运行 create-test-user.ts')
    return
  }

  const userId = user.id
  console.log('找到测试用户:', userId)

  // 创建联盟网络
  const networks = [
    { shortName: 'LH', name: 'LinkHaitao' },
    { shortName: 'PM', name: 'Partnermatic' },
    { shortName: 'RW', name: 'Rewardoo' },
    { shortName: 'LB', name: 'Linkbux' },
  ]

  console.log('\n创建联盟网络...')
  for (const n of networks) {
    await prisma.affiliateNetwork.upsert({
      where: { userId_shortName: { userId, shortName: n.shortName } },
      create: { userId, shortName: n.shortName, name: n.name, status: 'active' },
      update: { name: n.name, deletedAt: null },
    })
    console.log('  ✅', n.shortName, '-', n.name)
  }

  // 获取网络 ID 映射
  const dbNetworks = await prisma.affiliateNetwork.findMany({
    where: { userId, deletedAt: null },
    select: { id: true, shortName: true },
  })
  const networkMap: Record<string, string> = {}
  for (const n of dbNetworks) {
    networkMap[n.shortName] = n.id
  }

  // 创建测试商家（根据用户提供的广告系列名称）
  const merchants = [
    {
      networkShortName: 'LH',
      mid: '38171',
      merchantName: 'Viagogo',
      domain: 'viagogo.com',
      trackingUrl: 'https://linkhaitao.com/track/lh38171?sub=SUBID',
    },
    {
      networkShortName: 'PM',
      mid: '87660',
      merchantName: 'Blinds Direct',
      domain: 'blindsdirect.com',
      trackingUrl: 'https://partnermatic.com/track/pm87660?sub=SUBID',
    },
    {
      networkShortName: 'PM',
      mid: '18645429',
      merchantName: 'Eventbrite',
      domain: 'eventbrite.com',
      trackingUrl: 'https://partnermatic.com/track/pm18645429?sub=SUBID',
    },
    {
      networkShortName: 'PM',
      mid: '53088',
      merchantName: 'Twoje Meble',
      domain: 'twojemeble.pl',
      trackingUrl: 'https://partnermatic.com/track/pm53088?sub=SUBID',
    },
    {
      networkShortName: 'LB',
      mid: '91135',
      merchantName: 'Colipays',
      domain: 'colipays.com',
      trackingUrl: 'https://linkbux.com/track/lb91135?sub=SUBID',
    },
    {
      networkShortName: 'RW',
      mid: '122314',
      merchantName: 'Katt The Label',
      domain: 'katthelabel.com.au',
      trackingUrl: 'https://rewardoo.com/track/rw122314?sub=SUBID',
    },
  ]

  console.log('\n创建测试商家...')
  for (const m of merchants) {
    const networkId = networkMap[m.networkShortName]
    if (!networkId) {
      console.log('  ⚠️ 跳过', m.mid, '- 网络不存在')
      continue
    }

    await prisma.affiliateMerchant.upsert({
      where: { userId_networkId_mid: { userId, networkId, mid: m.mid } },
      create: {
        userId,
        networkId,
        mid: m.mid,
        mcid: m.mid,
        merchantName: m.merchantName,
        domain: m.domain,
        siteUrl: 'https://' + m.domain,
        trackingUrl: m.trackingUrl,
        merchantStatus: 'Online',
        lastSyncedAt: new Date(),
      },
      update: {
        merchantName: m.merchantName,
        domain: m.domain,
        trackingUrl: m.trackingUrl,
        deletedAt: null,
      },
    })
    console.log('  ✅', m.networkShortName, '|', m.mid, '|', m.merchantName)
  }

  console.log('\n✅ 测试数据创建完成！')

  // 显示统计
  const stats = await prisma.affiliateMerchant.groupBy({
    by: ['networkId'],
    where: { userId, deletedAt: null },
    _count: true,
  })

  console.log('\n📊 数据统计:')
  for (const s of stats) {
    const network = dbNetworks.find(n => n.id === s.networkId)
    console.log(`   ${network?.shortName}: ${s._count} 个商家`)
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
