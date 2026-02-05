/**
 * Campaign 代理诊断脚本
 *
 * 用途：
 * 1. 检查指定 campaign 的用户分配了哪些代理
 * 2. 检查这些代理的出口 IP 在 24 小时内是否都被使用过
 * 3. 测试当前代理服务的响应时间和可用性
 *
 * 使用方法：
 * node scripts/diagnose-campaign-proxy.js <campaignId>
 *
 * 示例：
 * node scripts/diagnose-campaign-proxy.js 706-LH1-consumercellular-US-1228-83626
 */

// 手动加载 .env.production 文件
try {
  require('fs').readFileSync('.env.production', 'utf-8').split('\n').forEach(line => {
    // 跳过注释和空行
    if (line.trim().startsWith('#') || !line.trim()) return;

    const match = line.match(/^([^=]+)=(.*)$/);
    if (match) {
      const key = match[1].trim();
      let value = match[2].trim();

      // 移除首尾的引号
      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }

      process.env[key] = value;
    }
  });

  // 如果是 Docker 环境（mysql 主机名），替换为 localhost
  if (process.env.DATABASE_URL && process.env.DATABASE_URL.includes('@mysql:')) {
    process.env.DATABASE_URL = process.env.DATABASE_URL.replace('@mysql:', '@localhost:');
    console.log('⚠️  检测到 Docker 配置，已将 mysql 主机名替换为 localhost\n');
  }
} catch (e) {
  console.error('⚠️  无法加载 .env.production:', e.message);
  console.log('尝试使用当前环境变量...\n');
}

const { PrismaClient } = require('@prisma/client');
const { SocksProxyAgent } = require('socks-proxy-agent');
const fetch = require('next/dist/compiled/node-fetch');

const prisma = new PrismaClient();

// 颜色输出
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
};

function log(color, ...args) {
  console.log(color, ...args, colors.reset);
}

// 处理用户名模板
function processUsernameTemplate(template, countryCode) {
  if (!template) return '';

  return template
    .replace(/\{COUNTRY\}/g, countryCode.toUpperCase())
    .replace(/\{country\}/g, countryCode.toLowerCase())
    .replace(/\{random:(\d+)\}/gi, (_, len) => {
      const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
      let result = '';
      for (let i = 0; i < parseInt(len); i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
      }
      return result;
    })
    .replace(/\{session:(\d+)\}/gi, (_, len) => {
      let result = '';
      for (let i = 0; i < parseInt(len); i++) {
        result += Math.floor(Math.random() * 10).toString();
      }
      return result;
    });
}

// 测试代理 IP 检测
async function testProxyIpDetection(proxy, username, password) {
  const proxyUrl = proxy.url.replace(/^socks5?:\/\//, '');
  const encodedUsername = username ? encodeURIComponent(username) : '';
  const encodedPassword = password ? encodeURIComponent(password) : '';
  const authPart = encodedUsername || encodedPassword
    ? `${encodedUsername}:${encodedPassword}@`
    : '';
  const fullProxyUrl = `socks5://${authPart}${proxyUrl}`;

  const testUrl = 'http://httpbin.org/ip';
  const timeout = 8000;

  const agent = new SocksProxyAgent(fullProxyUrl, { timeout });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  const startTime = Date.now();
  try {
    const response = await fetch(testUrl, {
      agent: agent,
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json',
      },
    });

    clearTimeout(timer);
    const elapsed = Date.now() - startTime;

    if (response.ok) {
      const data = await response.json();
      const ip = data.origin ? String(data.origin).split(',')[0]?.trim() : null;
      return {
        success: true,
        ip,
        elapsed,
      };
    } else {
      return {
        success: false,
        error: `HTTP ${response.status}`,
        elapsed,
      };
    }
  } catch (err) {
    clearTimeout(timer);
    const elapsed = Date.now() - startTime;
    return {
      success: false,
      error: err.message,
      elapsed,
    };
  }
}

// 测试代理连接性
async function testProxyConnectivity(proxy, username, password) {
  const proxyUrl = proxy.url.replace(/^socks5?:\/\//, '');
  const encodedUsername = username ? encodeURIComponent(username) : '';
  const encodedPassword = password ? encodeURIComponent(password) : '';
  const authPart = encodedUsername || encodedPassword
    ? `${encodedUsername}:${encodedPassword}@`
    : '';
  const fullProxyUrl = `socks5://${authPart}${proxyUrl}`;

  const testUrl = 'http://www.google.com/robots.txt';
  const timeout = 10000;

  const agent = new SocksProxyAgent(fullProxyUrl, { timeout });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  const startTime = Date.now();
  try {
    const response = await fetch(testUrl, {
      agent: agent,
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    });

    clearTimeout(timer);
    const elapsed = Date.now() - startTime;

    return {
      success: response.ok,
      elapsed,
      error: response.ok ? null : `HTTP ${response.status}`,
    };
  } catch (err) {
    clearTimeout(timer);
    const elapsed = Date.now() - startTime;
    return {
      success: false,
      elapsed,
      error: err.message,
    };
  }
}

async function diagnoseCampaign(campaignId) {
  try {
    log(colors.cyan, '\n========================================');
    log(colors.cyan, `🔍 诊断 Campaign: ${campaignId}`);
    log(colors.cyan, '========================================\n');

    // 1. 查询 campaign 信息
    log(colors.blue, '📋 步骤 1: 查询 Campaign 信息...');
    const campaign = await prisma.campaignMeta.findFirst({
      where: {
        campaignId,
        deletedAt: null,
      },
      include: {
        user: {
          select: { id: true, email: true },
        },
      },
    });

    if (!campaign) {
      log(colors.red, `❌ 未找到 Campaign: ${campaignId}`);
      return;
    }

    log(colors.green, `✅ Campaign 名称: ${campaign.name}`);
    log(colors.gray, `   国家: ${campaign.country}`);
    log(colors.gray, `   用户: ${campaign.user.email} (${campaign.userId})`);
    log(colors.gray, `   Final URL: ${campaign.finalUrl || '(未设置)'}\n`);

    // 2. 查询用户分配的代理
    log(colors.blue, '📋 步骤 2: 查询用户分配的代理供应商...');
    const userProxies = await prisma.proxyProvider.findMany({
      where: {
        enabled: true,
        deletedAt: null,
        assignedUsers: {
          some: {
            userId: campaign.userId,
          },
        },
      },
      orderBy: {
        priority: 'asc',
      },
    });

    if (userProxies.length === 0) {
      log(colors.red, `❌ 该用户未分配任何代理供应商！`);
      log(colors.yellow, `💡 建议: 在管理后台 → 代理管理 → 为用户 ${campaign.user.email} 分配代理\n`);
      return;
    }

    log(colors.green, `✅ 找到 ${userProxies.length} 个代理供应商:\n`);
    userProxies.forEach((p, i) => {
      log(colors.gray, `   ${i + 1}. ${p.name}`);
      log(colors.gray, `      优先级: ${p.priority}`);
      log(colors.gray, `      地址: ${p.host}:${p.port}`);
      log(colors.gray, `      用户名模板: ${p.usernameTemplate}`);
      log(colors.gray, `      密码: ${p.password ? '***' + p.password.slice(-4) : '(无)'}\n`);
    });

    // 3. 检查 24 小时内的 IP 使用情况
    log(colors.blue, '📋 步骤 3: 检查 24 小时内的 IP 使用情况...');
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const usedIps = await prisma.proxyExitIpUsage.findMany({
      where: {
        userId: campaign.userId,
        campaignId: campaignId,
        usedAt: {
          gte: twentyFourHoursAgo,
        },
      },
      orderBy: {
        usedAt: 'desc',
      },
    });

    if (usedIps.length === 0) {
      log(colors.green, `✅ 24 小时内未使用任何 IP（无去重限制）\n`);
    } else {
      log(colors.yellow, `⚠️  24 小时内已使用 ${usedIps.length} 个 IP:\n`);
      usedIps.slice(0, 10).forEach((ip, i) => {
        const timeAgo = Math.floor((Date.now() - ip.usedAt.getTime()) / 1000 / 60);
        log(colors.gray, `   ${i + 1}. ${ip.exitIp} (${timeAgo} 分钟前)`);
      });
      if (usedIps.length > 10) {
        log(colors.gray, `   ... 还有 ${usedIps.length - 10} 个\n`);
      } else {
        console.log();
      }
    }

    const usedIpSet = new Set(usedIps.map(ip => ip.exitIp));

    // 4. 测试每个代理的可用性
    log(colors.blue, '📋 步骤 4: 测试代理可用性（这可能需要一些时间）...\n');

    const country = campaign.country || 'US';
    let availableProxyCount = 0;
    let ipCheckFailedCount = 0;
    let connectivityFailedCount = 0;

    for (let i = 0; i < userProxies.length; i++) {
      const provider = userProxies[i];
      log(colors.cyan, `\n🔧 测试代理 ${i + 1}/${userProxies.length}: ${provider.name}`);
      log(colors.gray, `   优先级: ${provider.priority}, 地址: ${provider.host}:${provider.port}`);

      // 构建用户名
      const username = processUsernameTemplate(provider.usernameTemplate || '', country);
      const password = provider.password || '';
      log(colors.gray, `   用户名: ${username}`);
      log(colors.gray, `   密码: ${password ? '***' + password.slice(-4) : '(无)'}`);

      const proxy = {
        url: `socks5://${provider.host}:${provider.port}`,
        username: username || undefined,
        password: password || undefined,
        protocol: 'socks5',
      };

      // 测试 IP 检测
      log(colors.gray, '   ⏳ 测试 IP 检测...');
      const ipResult = await testProxyIpDetection(proxy, username, password);

      if (ipResult.success && ipResult.ip) {
        const isUsed = usedIpSet.has(ipResult.ip);
        if (isUsed) {
          log(colors.yellow, `   ⚠️  IP 检测成功: ${ipResult.ip} (${ipResult.elapsed}ms)`);
          log(colors.yellow, `   ⚠️  但该 IP 在 24 小时内已使用，会被跳过`);
        } else {
          log(colors.green, `   ✅ IP 检测成功: ${ipResult.ip} (${ipResult.elapsed}ms)`);
          log(colors.green, `   ✅ 该 IP 可用（未在 24 小时内使用）`);
          availableProxyCount++;
        }
      } else {
        log(colors.red, `   ❌ IP 检测失败: ${ipResult.error} (${ipResult.elapsed}ms)`);
        ipCheckFailedCount++;

        // 测试连接性（降级模式）
        log(colors.gray, '   ⏳ 测试连接性（降级模式）...');
        const connResult = await testProxyConnectivity(proxy, username, password);

        if (connResult.success) {
          log(colors.green, `   ✅ 连接测试成功 (${connResult.elapsed}ms)`);
          log(colors.green, `   ✅ 降级模式可用（跳过 IP 检测）`);
          availableProxyCount++;
        } else {
          log(colors.red, `   ❌ 连接测试失败: ${connResult.error} (${connResult.elapsed}ms)`);
          connectivityFailedCount++;
        }
      }
    }

    // 5. 总结
    log(colors.cyan, '\n========================================');
    log(colors.cyan, '📊 诊断总结');
    log(colors.cyan, '========================================\n');

    log(colors.gray, `总代理数: ${userProxies.length}`);
    log(colors.gray, `24h 已使用 IP 数: ${usedIps.length}`);

    if (availableProxyCount > 0) {
      log(colors.green, `✅ 可用代理数: ${availableProxyCount}`);
    } else {
      log(colors.red, `❌ 可用代理数: 0`);
    }

    if (ipCheckFailedCount > 0) {
      log(colors.yellow, `⚠️  IP 检测失败: ${ipCheckFailedCount}`);
    }

    if (connectivityFailedCount > 0) {
      log(colors.red, `❌ 连接测试失败: ${connectivityFailedCount}`);
    }

    console.log();

    // 6. 建议
    log(colors.cyan, '💡 建议:\n');

    if (availableProxyCount === 0) {
      log(colors.red, '❌ 所有代理均不可用！');

      if (ipCheckFailedCount === userProxies.length) {
        log(colors.yellow, '\n可能原因：');
        log(colors.gray, '1. 代理服务响应慢，IP 检测超时（当前超时: 8 秒）');
        log(colors.gray, '2. 代理用户名/密码配置错误');
        log(colors.gray, '3. 代理服务暂时不可用');
        log(colors.gray, '4. 网络连接问题');

        log(colors.yellow, '\n解决方案：');
        log(colors.gray, '1. 增加 IP 检测超时时间（修改 src/lib/proxy-selector.ts:184）');
        log(colors.gray, '2. 检查代理用户名模板是否正确（特别是 {COUNTRY} 大小写）');
        log(colors.gray, '3. 在管理后台测试代理配置');
        log(colors.gray, '4. 联系代理服务商确认服务状态');
      } else if (connectivityFailedCount > 0) {
        log(colors.yellow, '\n可能原因：');
        log(colors.gray, '1. 所有可用 IP 在 24 小时内都已使用');
        log(colors.gray, '2. 降级模式的连接测试也失败');

        log(colors.yellow, '\n解决方案：');
        log(colors.gray, '1. 增加更多代理供应商');
        log(colors.gray, '2. 等待 24 小时后 IP 去重过期');
        log(colors.gray, '3. 降低并发数，减少 IP 消耗速度');
      }
    } else if (availableProxyCount < 3) {
      log(colors.yellow, `⚠️  可用代理数较少（${availableProxyCount}），可能导致高并发时失败`);
      log(colors.gray, '\n建议：');
      log(colors.gray, '1. 增加更多代理供应商');
      log(colors.gray, '2. 降低并发参数（STOCK_CONCURRENCY, CAMPAIGN_CONCURRENCY）');
    } else {
      log(colors.green, `✅ 代理配置正常，有 ${availableProxyCount} 个可用代理`);

      if (ipCheckFailedCount > 0 || connectivityFailedCount > 0) {
        log(colors.yellow, '\n注意：');
        log(colors.gray, `部分代理不可用（IP 检测失败: ${ipCheckFailedCount}, 连接失败: ${connectivityFailedCount}）`);
        log(colors.gray, '建议检查这些代理的配置或联系服务商');
      }
    }

    console.log();

  } catch (error) {
    log(colors.red, '\n❌ 诊断过程出错:', error.message);
    console.error(error);
  } finally {
    await prisma.$disconnect();
  }
}

// 主函数
async function main() {
  const campaignId = process.argv[2];

  if (!campaignId) {
    console.log('用法: node scripts/diagnose-campaign-proxy.js <campaignId>');
    console.log('示例: node scripts/diagnose-campaign-proxy.js 706-LH1-consumercellular-US-1228-83626');
    process.exit(1);
  }

  await diagnoseCampaign(campaignId);
}

main().catch(console.error);
