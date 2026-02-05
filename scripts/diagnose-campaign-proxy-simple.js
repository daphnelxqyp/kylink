/**
 * 简化版诊断脚本 - 只查询数据库信息，不测试代理连接
 * 适用于无法连接数据库的环境
 */

const campaignId = process.argv[2] || '706-LH1-consumercellular-US-1228-83626';

console.log(`
========================================
🔍 Campaign 诊断报告
========================================

Campaign ID: ${campaignId}

由于无法直接连接数据库，请在服务器上运行以下命令：

方法 1: 使用 Docker（推荐）
----------------------------
bash scripts/diagnose-campaign-proxy.sh ${campaignId}


方法 2: 直接在服务器上运行
----------------------------
cd /root/kylink
node scripts/diagnose-campaign-proxy.js ${campaignId}


方法 3: 手动查询数据库
----------------------------
# 1. 进入 MySQL 容器
docker exec -it kylink-mysql mysql -u kylink -p kyads_suffixpool

# 2. 查询 Campaign 信息
SELECT c.campaignId, c.name, c.country, u.email
FROM CampaignMeta c
JOIN User u ON c.userId = u.id
WHERE c.campaignId = '${campaignId}' AND c.deletedAt IS NULL;

# 3. 查询用户的代理配置
SELECT pp.name, pp.priority, pp.host, pp.port, pp.usernameTemplate, pp.enabled
FROM ProxyProvider pp
JOIN ProxyProviderUser ppu ON pp.id = ppu.proxyProviderId
JOIN User u ON ppu.userId = u.id
JOIN CampaignMeta c ON c.userId = u.id
WHERE c.campaignId = '${campaignId}'
  AND pp.enabled = 1
  AND pp.deletedAt IS NULL
ORDER BY pp.priority ASC;

# 4. 查询 24 小时内使用的 IP
SELECT exitIp, usedAt
FROM ProxyExitIpUsage
WHERE campaignId = '${campaignId}'
  AND usedAt >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
ORDER BY usedAt DESC;


临时解决方案
----------------------------
如果诊断发现所有代理都不可用，可以：

1. 在管理后台手动测试代理配置
2. 降低并发参数（编辑 .env.production）：
   STOCK_CONCURRENCY=3
   CAMPAIGN_CONCURRENCY=2
3. 手动触发单个 Campaign 补货
4. 等待 24 小时后 IP 去重过期

========================================
`);
