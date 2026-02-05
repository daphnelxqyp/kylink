# 🐛 Bug 修复报告：代理认证失败问题

## 📋 问题总结

**症状**：批量补货时，部分 campaign 报错 `NO_PROXY_AVAILABLE: 所有代理均不可用`

**根本原因**：数据库中存储的国家字段是完整国家名称（如 "United States"），而不是国家代码（如 "US"），导致代理用户名模板中包含空格，SOCKS5 认证失败。

---

## 🔍 问题分析

### 1. 错误日志

```
[proxy-selector] Country: United States → Username: 4197658-8c0cae65-UNITED STATES-session-27433202-life-5m
[proxy-selector] Connectivity test failed: Socks5 Authentication failed
```

**问题**：
- 期望用户名：`4197658-8c0cae65-US-session-xxx-life-5m`
- 实际用户名：`4197658-8c0cae65-UNITED STATES-session-xxx-life-5m`（包含空格！）

### 2. 数据流

```
Google Ads 脚本
  ↓ (country: "United States")
campaigns/sync API
  ↓ (直接存储到数据库)
CampaignMeta.country = "United States"
  ↓ (补货时读取)
stock-producer.ts: const country = campaign?.country || 'US'
  ↓ (传给代理选择器)
proxy-selector.ts: processUsernameTemplate(template, "United States")
  ↓ (替换 {COUNTRY})
代理用户名：4197658-8c0cae65-UNITED STATES-session-xxx
  ↓
❌ SOCKS5 认证失败
```

### 3. 为什么"完整测试"正常？

管理后台的代理测试使用的是**硬编码的国家代码**（如 "US"），而不是从数据库读取，所以能通过。

---

## ✅ 修复方案

### 修改的文件

1. **新增文件**：`src/lib/country-codes.ts`
   - 包含 200+ 个国家名称到代码的映射
   - 提供 `normalizeCountryCode()` 函数

2. **修改文件**：`src/lib/stock-producer.ts`
   - 第 19 行：导入 `normalizeCountryCode`
   - 第 397 行：使用 `normalizeCountryCode(campaign?.country)` 替代直接使用

3. **修改文件**：`src/lib/suffix-generator.ts`
   - 第 27 行：导入 `normalizeCountryCode`
   - 第 450 行：使用 `normalizeCountryCode(campaign?.country)` 替代直接使用

### 核心代码

```typescript
// src/lib/country-codes.ts
export function normalizeCountryCode(countryInput: string | null | undefined): string {
  if (!countryInput) return 'US'

  let country = countryInput.trim()

  // 如果包含逗号，只取第一个
  if (country.includes(',')) {
    country = country.split(',')[0].trim()
  }

  // 如果已经是 2 位代码，直接返回
  if (/^[A-Z]{2}$/.test(country)) {
    return country
  }

  // 从映射表查找
  const code = COUNTRY_NAME_TO_CODE[country]
  if (code) {
    return code
  }

  // 默认返回 US
  console.warn(`[normalizeCountryCode] Unknown country: "${country}", using default "US"`)
  return 'US'
}
```

---

## 🚀 部署步骤

### 方法 1：自动部署（推荐）

```bash
# 1. 上传修改后的代码到服务器
scp -r src root@your-server:/opt/kylink/
scp scripts/fix-country-code.sh root@your-server:/opt/kylink/scripts/

# 2. SSH 到服务器
ssh root@your-server

# 3. 运行部署脚本
cd /opt/kylink
bash scripts/fix-country-code.sh
```

### 方法 2：手动部署

```bash
# 1. SSH 到服务器
ssh root@your-server
cd /opt/kylink

# 2. 备份当前代码
cp -r src backup-$(date +%Y%m%d-%H%M%S)/

# 3. 上传新代码（从本地）
# 在本地执行：
scp -r src root@your-server:/opt/kylink/

# 4. 编译
npm run build

# 5. 重启服务
systemctl restart kylink

# 6. 查看日志
journalctl -u kylink -f
```

---

## ✅ 验证修复

### 1. 检查日志

```bash
journalctl -u kylink -n 100 --no-pager | grep "Country:"
```

**修复前**：
```
Country: United States → Username: 4197658-8c0cae65-UNITED STATES-session-xxx
```

**修复后**：
```
Country: US → Username: 4197658-8c0cae65-US-session-xxx
```

### 2. 触发补货测试

1. 登录管理后台
2. 进入"库存管理"页面
3. 点击"补货所有低水位"
4. 观察日志，确认没有 `Socks5 Authentication failed` 错误

### 3. 检查失败的 campaign

```bash
# 在服务器上运行诊断脚本
cd /opt/kylink
node scripts/diagnose-campaign-proxy.js 706-LH1-consumercellular-US-1228-83626
```

应该看到：
```
✅ 可用代理数: 3
✅ 代理配置正常
```

---

## 📊 影响范围

### 受影响的 Campaign

所有国家字段为完整名称的 campaign，包括但不限于：
- `United States` → `US`
- `United Kingdom` → `GB`
- `Kuwait` → `KW`
- 等等

### 不受影响的 Campaign

- 国家字段已经是 2 位代码的（如 `US`、`GB`）
- 国家字段为空的（默认使用 `US`）

---

## 🔮 后续优化建议

### 1. 数据库迁移（可选）

将数据库中的完整国家名称统一转换为代码：

```sql
-- 备份表
CREATE TABLE CampaignMeta_backup AS SELECT * FROM CampaignMeta;

-- 更新常见国家
UPDATE CampaignMeta SET country = 'US' WHERE country = 'United States';
UPDATE CampaignMeta SET country = 'GB' WHERE country = 'United Kingdom';
UPDATE CampaignMeta SET country = 'KW' WHERE country = 'Kuwait';
-- ... 更多国家
```

**注意**：这是可选的，因为代码已经能自动转换。

### 2. 在 sync 接口中标准化

修改 `campaigns/sync` 接口，在存储前就转换为代码：

```typescript
// src/app/api/v1/campaigns/sync/route.ts
import { normalizeCountryCode } from '@/lib/country-codes'

// 在创建/更新时
country: normalizeCountryCode(campaign.country),
```

### 3. 添加单元测试

```bash
npm test -- country-codes.test.ts
```

---

## 📝 总结

| 项目 | 内容 |
|------|------|
| **问题** | 国家名称包含空格导致代理认证失败 |
| **根因** | 数据库存储完整国家名，未转换为代码 |
| **修复** | 添加标准化函数，自动转换为 ISO 代码 |
| **影响** | 所有使用完整国家名的 campaign |
| **风险** | 低（向后兼容，已有代码的不受影响） |
| **测试** | 编译通过，需要实际环境验证 |

---

## 🆘 故障排查

如果修复后仍有问题：

1. **检查代码是否正确部署**
   ```bash
   grep -n "normalizeCountryCode" src/lib/stock-producer.ts
   # 应该看到第 19 行和第 397 行
   ```

2. **检查编译是否成功**
   ```bash
   ls -la .next/server/app/api/v1/suffix/
   # 应该看到最新的编译时间
   ```

3. **检查服务是否重启**
   ```bash
   systemctl status kylink
   # 应该看到最近的重启时间
   ```

4. **查看完整日志**
   ```bash
   journalctl -u kylink -n 500 --no-pager > /tmp/kylink.log
   # 发送日志文件进行分析
   ```

---

**修复时间**：2026-02-05
**修复人员**：Claude Sonnet 4.5
**版本**：v1.0.0-fix-country-code
