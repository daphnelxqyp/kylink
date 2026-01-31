#!/usr/bin/env node
/**
 * 代理连接测试脚本
 * 
 * 使用方法：
 *   node test-proxy.js
 * 
 * 或者安装依赖后运行：
 *   npm install node-fetch https-proxy-agent
 *   node test-proxy.js
 */

const https = require('https');
const http = require('http');
const { URL } = require('url');

// ============================================
// 代理配置
// ============================================
const PROXIES = [
  {
    name: 'ipidea',
    host: '99e724e4c034b087.qzc.na.ipidea.online',
    port: 2333,
    username: 'jrhmjUVXXLqsV403kn-zone-custom-region-us-session-{random}-sessTime-5',
    password: 'yjWSrf6Q30',
  },
  {
    name: 'abc_test',
    host: 'as.cbeb09223deff7d4.abcproxy.vip',
    port: 4950,
    username: 'xcabc3222395_68db-zone-abc-region-US-session-{random}-sessTime-5',
    password: 'kydir405',
  },
];

const TEST_URL = 'http://httpbin.org/ip';
const TIMEOUT = 30000; // 30秒超时

// ============================================
// 工具函数
// ============================================

function generateRandom(length = 8) {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

function processUsername(template) {
  return template.replace('{random}', generateRandom(9));
}

// ============================================
// HTTP 代理请求（使用原生 http 模块）
// ============================================

function testProxyWithHttp(proxy) {
  return new Promise((resolve) => {
    const username = processUsername(proxy.username);
    const auth = Buffer.from(`${username}:${proxy.password}`).toString('base64');
    
    const targetUrl = new URL(TEST_URL);
    
    const options = {
      hostname: proxy.host,
      port: proxy.port,
      method: 'GET',
      path: TEST_URL,
      headers: {
        'Host': targetUrl.hostname,
        'Proxy-Authorization': `Basic ${auth}`,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
      timeout: TIMEOUT,
    };

    const startTime = Date.now();
    
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        const elapsed = Date.now() - startTime;
        if (res.statusCode === 200) {
          try {
            const json = JSON.parse(data);
            resolve({ success: true, ip: json.origin, elapsed, status: res.statusCode });
          } catch {
            resolve({ success: true, data, elapsed, status: res.statusCode });
          }
        } else {
          resolve({ success: false, status: res.statusCode, data, elapsed });
        }
      });
    });

    req.on('error', (err) => {
      const elapsed = Date.now() - startTime;
      resolve({ success: false, error: err.message, elapsed });
    });

    req.on('timeout', () => {
      req.destroy();
      const elapsed = Date.now() - startTime;
      resolve({ success: false, error: 'Connection timeout', elapsed });
    });

    req.end();
  });
}

// ============================================
// 直连测试
// ============================================

function testDirect() {
  return new Promise((resolve) => {
    const targetUrl = new URL(TEST_URL);
    const startTime = Date.now();
    
    const req = http.get(TEST_URL, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
      timeout: TIMEOUT,
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        const elapsed = Date.now() - startTime;
        try {
          const json = JSON.parse(data);
          resolve({ success: true, ip: json.origin, elapsed });
        } catch {
          resolve({ success: true, data, elapsed });
        }
      });
    });

    req.on('error', (err) => {
      const elapsed = Date.now() - startTime;
      resolve({ success: false, error: err.message, elapsed });
    });

    req.on('timeout', () => {
      req.destroy();
      resolve({ success: false, error: 'Connection timeout', elapsed: Date.now() - startTime });
    });
  });
}

// ============================================
// DNS 测试
// ============================================

function testDns(hostname) {
  return new Promise((resolve) => {
    const dns = require('dns');
    dns.resolve4(hostname, (err, addresses) => {
      if (err) {
        resolve({ success: false, error: err.message });
      } else {
        resolve({ success: true, addresses });
      }
    });
  });
}

// ============================================
// 端口连通性测试
// ============================================

function testPort(host, port) {
  return new Promise((resolve) => {
    const net = require('net');
    const socket = new net.Socket();
    const startTime = Date.now();
    
    socket.setTimeout(5000);
    
    socket.on('connect', () => {
      socket.destroy();
      resolve({ success: true, elapsed: Date.now() - startTime });
    });
    
    socket.on('timeout', () => {
      socket.destroy();
      resolve({ success: false, error: 'Connection timeout' });
    });
    
    socket.on('error', (err) => {
      resolve({ success: false, error: err.message });
    });
    
    socket.connect(port, host);
  });
}

// ============================================
// 主测试流程
// ============================================

async function main() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║             代理连接测试脚本 v1.0                          ║');
  console.log('╠════════════════════════════════════════════════════════════╣');
  console.log('║ 测试目标: http://httpbin.org/ip                            ║');
  console.log('║ 超时时间: 30 秒                                            ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log('');
  
  // 1. 测试直连
  console.log('📡 测试直连...');
  const directResult = await testDirect();
  if (directResult.success) {
    console.log(`   ✅ 成功! 出口 IP: ${directResult.ip} (${directResult.elapsed}ms)`);
  } else {
    console.log(`   ❌ 失败: ${directResult.error}`);
  }
  console.log('');
  
  // 2. 测试每个代理
  for (const proxy of PROXIES) {
    console.log(`════════════════════════════════════════`);
    console.log(`📦 测试代理: ${proxy.name}`);
    console.log(`   主机: ${proxy.host}:${proxy.port}`);
    console.log('');
    
    // DNS 测试
    console.log('   1️⃣ DNS 解析...');
    const dnsResult = await testDns(proxy.host);
    if (dnsResult.success) {
      console.log(`      ✅ 成功: ${dnsResult.addresses.join(', ')}`);
    } else {
      console.log(`      ❌ 失败: ${dnsResult.error}`);
      console.log('');
      continue;
    }
    
    // 端口测试
    console.log('   2️⃣ 端口连通性...');
    const portResult = await testPort(proxy.host, proxy.port);
    if (portResult.success) {
      console.log(`      ✅ 成功: TCP 连接正常 (${portResult.elapsed}ms)`);
    } else {
      console.log(`      ❌ 失败: ${portResult.error}`);
      console.log('');
      continue;
    }
    
    // 代理请求测试
    console.log('   3️⃣ 代理请求测试 (最多30秒)...');
    const proxyResult = await testProxyWithHttp(proxy);
    if (proxyResult.success) {
      console.log(`      ✅ 成功! 出口 IP: ${proxyResult.ip} (${proxyResult.elapsed}ms)`);
    } else {
      if (proxyResult.status) {
        console.log(`      ❌ 失败: HTTP ${proxyResult.status}`);
        if (proxyResult.data) {
          console.log(`         响应: ${proxyResult.data.slice(0, 100)}`);
        }
      } else {
        console.log(`      ❌ 失败: ${proxyResult.error} (${proxyResult.elapsed}ms)`);
      }
    }
    console.log('');
  }
  
  // 总结
  console.log('════════════════════════════════════════');
  console.log('📊 测试完成!');
  console.log('');
  console.log('如果直连成功但代理失败，可能的原因：');
  console.log('  1. 代理账户配额用尽');
  console.log('  2. 代理服务商服务异常');
  console.log('  3. 本地网络到代理服务器的链路问题');
  console.log('  4. 账户/密码配置错误');
  console.log('');
  console.log('建议在服务器或其他网络环境执行此脚本对比测试。');
}

main().catch(console.error);

