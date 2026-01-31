# KyAds SuffixPool 项目 PRD（上线版 · 精简无矛盾）

> **版本**：1.4（2026-01-14）  
> **一句话**：Google Ads Scripts 周期性上报各 Campaign 的"今日累计 clicks"，后端以 **"上次成功换链时的 clicks（lastAppliedClicks）"** 为基准判定 `delta>0`；若需换链则返回 1 条新的 `finalUrlSuffix`（幂等、可重试）；脚本写入 `Campaign.final_url_suffix` 后 **必须 ack**。后端负责：suffix 预生产、库存、幂等发放、失败可恢复、去重、多租户隔离。Campaign 元数据采用**混合存储 + 增量同步**策略：表格作为可视化入口，数据库作为唯一数据源。

---

## 1. 目标与范围

### 1.1 必须目标（MUST）

- **触发**：仅当 `delta = nowClicks - lastAppliedClicks > 0` 才触发换链。
- **单次**：`delta>0` 时 **只换 1 次**（不按 delta 次数消耗库存）。
- **职责边界**：
  - Scripts：**读 clicks → 调用 lease → 写 final_url_suffix → ack**；不做追踪/代理/去重/库存/一致性锁。
  - API：**生成/库存/发放/回收/补货/可观测**；保存换链判定所需的一致性状态。
- **可恢复**：网络抖动/脚本重跑/双脚本并发下，**不重复消耗库存**，且可通过“返回同一租约”进行重试。
- **多租户**：API Key 绑定用户；库存/去重/状态必须带 `userId` 维度隔离。

### 1.2 非目标（NOT）

- API 不负责从 Google Ads 拉取 clicks（clicks 只能由 Scripts 读取上报）。
- Scripts 不使用 Google 表格承担一致性状态（不在 Sheet2/Sheet3 做锁与断点）。

---

## 2. 总体架构

### 2.1 组件

- **Google Ads Scripts**
  - 扫描 MCC → CID(active) → Campaign(enabled)
  - 读取 Campaign 元数据：`campaignName`、`campaignId`、`country`、`finalUrl`、`todayClicks`、`cid`、`mccId`
  - 批量查询 clicks（TODAY），使用 `executeInParallel()` 并行处理多账户
  - **数据同步**（混合模式）：
    - 写入 Sheet1（全量，可视化入口）
    - 调用 API 增量同步（仅变化时）或 lease 时附带 meta（惰性同步）
  - 调用 API：`/v1/suffix/lease`（或批量 `/v1/suffix/lease/batch`）、`/v1/suffix/ack`（或批量 `/v1/suffix/ack/batch`）
  - 可选：本地 Hint 预过滤，跳过明显无变化的 campaign
  - 写入：`Campaign.final_url_suffix`（Campaign 级别）

- **Suffix API**
  - 用户配置：`spreadsheetId`、API Key（仅存 hash）
  - **CampaignMeta**：数据库为唯一数据源（可从 Sheet1 初始导入，或由 Scripts 增量/惰性同步）
  - 联盟链接管理
  - suffix 生产：代理 + 跳转追踪 + 生成 finalUrlSuffix
  - 库存：按 `(userId, campaignId)` 维护
  - **发放**：幂等 lease、单 campaign 单活跃租约、ack 驱动状态推进
  - 后台：低水位补货、leased 超时回收、suffix 过期清理、统计与告警

### 2.2 数据同步策略（混合模式）

> **核心原则**：表格作为可视化入口，数据库作为唯一数据源。

```
┌─────────────────────────────────────────────────────────────────┐
│                     Google Ads Scripts                          │
│  扫描 Campaign 元数据: name, id, country, finalUrl, cid, mccId  │
└───────────────────────────┬─────────────────────────────────────┘
                            │
            ┌───────────────┴───────────────┐
            ▼                               ▼
┌─────────────────────┐        ┌─────────────────────────────────┐
│  写入 Sheet1（全量） │        │  调用 API 同步                   │
│  - 运营可视化入口   │        │  - 增量同步：/v1/campaigns/sync  │
│  - 调试友好         │        │  - 惰性同步：lease 时附带 meta   │
│  - 不承担业务一致性 │        │  - 数据库为唯一数据源            │
└─────────────────────┘        └─────────────────────────────────┘
```

#### 2.2.1 同步方式

| 方式 | 触发时机 | 说明 |
|------|----------|------|
| **增量同步** | Campaign 数据变化时 | 脚本检测 hash 变化，调用 `/v1/campaigns/sync` 批量上报 |
| **惰性同步** | lease 请求时 | 请求附带 `meta` 字段，后端发现不存在或变化时自动更新 |
| **手动导入** | 运营操作 | 从 Sheet1 导入到数据库（初始化/兜底） |

#### 2.2.2 存储定位

| 存储位置 | 定位 | 职责 |
|----------|------|------|
| **Sheet1** | 可视化 + 运营入口 | 展示清单、人工查看/修正、初始导入来源 |
| **数据库 CampaignMeta** | **唯一数据源** | 所有业务逻辑基于此、关联查询、状态存储 |

---

## 3. Google 表格约定（每用户一份）

> **重要定位**：表格只做"清单/运营可视化/初始导入来源"，**不承担业务一致性**。
> - ❌ 不做 lastClicks/锁/断点
> - ❌ 不作为 API 业务逻辑的数据源
> - ✅ 仅作为人工可视化入口和初始导入来源

### 3.1 Sheet1：Campaign 清单（必需）

字段（必需）：
- `campaignName`：广告系列名称
- `campaignId`：广告系列 ID（全局唯一）
- `country`：目标投放国家（用于代理出口选择）
- `finalUrl`：最终到达网址（用于联盟链接配置参考）
- `todayClicks`：今日累计点击数（使用 `segments.date DURING TODAY` 和 `metrics.clicks` 获取，无今日数据时默认为 0）
- `cid`：子账号 CID
- `mccId`：MCC ID
- `updatedAt`：最后更新时间

> **注意**：`finalUrl` 变化可能影响联盟链接配置，后端检测到变化时应告警运营。

### 3.2 Sheet3：可选（Hint Cache 持久化）

> 用于跨脚本实例共享 Hint，减少重启后的全量 API 调用。

建议字段（可选）：
- `campaignId`
- `lastReportedClicks`
- `updatedAt`

**注意**：Sheet3 仅作为性能优化的 Hint 存储，**不承担一致性状态**。即使数据丢失/不准确，也不影响换链正确性。

---

## 4. Scripts 行为规范（上线口径）

### 4.1 频率（可配置）

- 脚本支持用户配置 `cycleMinutes`（每轮检测间隔）。
- **推荐默认**：10 分钟（更贴合 Ads 数据延迟 & 降低超时/配额风险）。
- **上线默认约束**：`10 <= cycleMinutes <= 60`  
  - 小于 10 分钟属于高风险模式，默认不开放（如需开放应由运维/管理员放开并承担配额风险）。

### 4.2 单次运行时间与部署方式

- Google Ads Scripts 单次执行上限约 30 分钟。
- 允许两种部署：
  - **单脚本**：每小时触发一次，单次执行内循环若干轮（由 `cycleMinutes` 决定）。
  - **双脚本 A/B（推荐长期稳定）**：两份同脚本错峰 ~30 分钟触发；一致性由 API 保证，无需表格锁。

### 4.3 clicks 获取方式（强制要求）

- 必须"批量查询"当日 clicks（TODAY），避免逐个 Campaign 调 stats 导致超时。
- 仅处理：
  - CID = active
  - Campaign = enabled
 - **允许 nowClicks 暂时下降（数据延迟）**：脚本侧或 API 侧需做“单调递增保护”。
   - 简单规则：`nowClicksForDecision = max(nowClicks, lastObservedClicks)`
   - 目的：避免因数据回落误判为“无新增点击”

### 4.4 Campaign 数据同步流程（混合模式）

> 每次脚本运行时，先同步 Campaign 元数据，再进入换链流程。

#### 4.4.1 执行顺序（重要）

**原则**：先写表格（可视化优先），再提交后端（业务同步）。
**强调**：数据库是唯一数据源；表格只负责展示与导入入口，**表格写入成功不代表业务已生效**。

```
┌─────────────────────────────────────────────────────────────────┐
│  Step 1: 扫描 Campaign 数据                                      │
│  - 读取 MCC → CID(active) → Campaign(enabled)                   │
│  - 收集: name, id, country, finalUrl, todayClicks, cid, mccId  │
└───────────────────────────┬─────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│  Step 2: 写入 Sheet1（优先，快速完成）                           │
│  - 全量刷新 Campaign 清单                                        │
│  - 运营可立即查看                                                │
│  - 失败不阻塞后续流程                                            │
└───────────────────────────┬─────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│  Step 3: 增量同步到后端（仅变化时）                              │
│  - 检测 hash 变化                                                │
│  - 调用 /v1/campaigns/sync                                       │
│  - 失败不阻塞后续流程（惰性同步兜底）                            │
└───────────────────────────┬─────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│  Step 4: 换链流程                                                │
│  - 读取 clicks → 调用 lease → 写入 suffix → 调用 ack            │
└─────────────────────────────────────────────────────────────────┘
```

**设计理由**：
- 表格是可视化入口，应优先保证运营可见性
- 后端故障不应影响运营查看 Campaign 清单
- 后端有惰性同步兜底，API 同步失败不影响换链流程
 - **业务最终以数据库为准**：表格可领先显示，但不代表已同步成功

#### 4.4.2 扫描 Campaign 元数据

1. 扫描 MCC → 所有 CID(active) → 所有 Campaign(enabled)
2. 读取每个 Campaign 的元数据：
   - `campaignName`：广告系列名称
   - `campaignId`：广告系列 ID
   - `country`：目标投放国家
   - `finalUrl`：最终到达网址
   - `todayClicks`：今日累计点击数（使用 `segments.date DURING TODAY` 和 `metrics.clicks` 获取，无今日数据时默认为 0）
   - `cid`：子账号 CID
   - `mccId`：MCC ID

#### 4.4.3 写入 Sheet1（全量，可视化）

- **执行时机**：扫描完成后立即执行（优先于 API 同步）
- 每次运行时全量刷新 Sheet1
- 用途：运营可视化、调试、初始导入来源
- **不承担业务一致性**
- **失败处理**：记录日志，继续执行后续流程

#### 4.4.4 增量同步到后端（推荐）

```javascript
// 伪代码：完整的同步流程
function syncCampaignData() {
  // Step 1: 扫描数据
  const campaigns = scanAllCampaigns();
  
  // Step 2: 先写表格（可视化优先）
  try {
    writeToSheet1(campaigns);
  } catch (e) {
    Logger.log('Sheet write failed, continue: ' + e.message);
  }
  
  // Step 3: 增量同步到后端（仅变化时）
  const currentHash = computeHash(campaigns);
  const lastSyncHash = PropertiesService.getScriptProperties().getProperty('campaignSyncHash');
  
  if (currentHash !== lastSyncHash) {
    try {
      const result = callApi('/v1/campaigns/sync', {
        campaigns: campaigns,
        syncMode: 'incremental'
      });
      if (result.ok) {
        PropertiesService.getScriptProperties().setProperty('campaignSyncHash', currentHash);
      }
    } catch (e) {
      // API 失败不影响后续换链流程（惰性同步兜底）
      Logger.log('Sync failed, will retry via lazy sync: ' + e.message);
    }
  }
  
  return campaigns;
}
```

**效果**：Campaign 配置不变时，跳过同步 API 调用，每日仅数次同步。

#### 4.4.5 惰性同步（兜底）

- 在 `/v1/suffix/lease` 请求时可附带 `meta` 字段
- 后端发现 campaignId 不存在或 meta 变化时自动创建/更新
- 作为增量同步的兜底机制

#### 4.4.6 异常处理

| 场景 | 处理方式 |
|------|----------|
| Sheet1 写入失败 | 记录日志，继续执行（不影响业务） |
| API 同步失败 | 记录日志，继续执行（惰性同步兜底） |
| 两者都失败 | 记录日志，换链流程中 lease 附带 meta 兜底 |

### 4.5 换链流程

#### 4.5.1 单个 campaign 流程（基础）

1. 读取该 campaign `nowClicks`（TODAY）。
2. （必选）单调递增保护：`nowClicksForDecision = max(nowClicks, lastObservedClicks)`。
3. （可选）Hint 预过滤：若 `nowClicksForDecision === hintCache[campaignId]`，跳过本轮（见 4.7）。
4. 计算 `windowStartEpochSeconds`（见 4.6）。
5. 调用 API `lease` 上报 `nowClicks` 并请求是否需要换链。
6. 若 API 返回 `action=APPLY`：
   - 将 `finalUrlSuffix` 写入 `Campaign.final_url_suffix`
   - 立即调用 `ack`（失败重试 3 次，指数退避）
7. 若 API 返回 `action=NOOP` 或 `code=NO_STOCK/PENDING_IMPORT`：记录日志并跳过。
8. 更新 `hintCache[campaignId] = nowClicksForDecision`。

#### 4.5.2 批量流程（推荐，性能优化）

1. 使用 `executeInParallel()` 并行扫描所有 CID，聚合所有 campaign 的 `nowClicks`。
2. （必选）单调递增保护：`nowClicksForDecision = max(nowClicks, lastObservedClicks)`。
3. （可选）Hint 预过滤：剔除 `nowClicksForDecision === hintCache[campaignId]` 的 campaign。
3. 按批次（每批 ≤100）调用 `/v1/suffix/lease/batch`。
4. 对所有 `action=APPLY` 的 campaign：
   - 切换到对应账户上下文
   - 写入 `Campaign.final_url_suffix`
   - 收集成功/失败结果
5. 按批次调用 `/v1/suffix/ack/batch` 回执所有租约结果。
6. 批量更新 `hintCache`（使用 `nowClicksForDecision`）。

> **推荐**：大规模账户（>50 CID）优先使用批量流程，可将 API 调用次数从 O(n) 降至 O(n/100)。

### 4.6 幂等键（脚本必须生成）

- **目标**：防重复调用，不强行冻结决策。
- `idempotencyKey = campaignId + ":" + windowStartEpochSeconds + ":" + nowClicksForDecision`
- `windowStartEpochSeconds`：以 `cycleMinutes` 为窗口对齐到整点分桶（方便分桶与日志对齐）。
- 规则：同一 `idempotencyKey` 必须返回同一租约/同一决策；`nowClicksForDecision` 增长时允许新决策。

### 4.7 性能优化：本地预过滤（Hint 机制）

> 背景：假设 70 个 CID、平均每 CID 10 个 Campaign，每 10 分钟一轮，每天约 10 万次 lease 调用。为降低 API 负载与脚本执行时间，允许脚本侧做"预过滤"。

#### 4.7.1 Hint Cache（可选）

- 脚本可在内存或表格中维护 `hintCache: { campaignId → lastReportedClicks }`。
- 若 `nowClicks === lastReportedClicks`，可跳过本轮 lease 调用（大概率 NOOP）。
- **重要**：Hint 仅作为优化提示，**不作为换链决策依据**。决策权始终在 API 的 `lastAppliedClicks`。
- Hint 丢失/不准确不影响正确性，只影响调用次数。

#### 4.7.2 Hint 更新时机

- 每次调用 lease 后（无论 APPLY/NOOP），更新 `hintCache[campaignId] = nowClicks`。
- 脚本重启后 Hint 丢失是正常的，会导致第一轮全量调用 lease，后续恢复增量。

#### 4.7.3 Hint 存储位置选择

| 存储位置 | 优点 | 缺点 |
|---------|------|------|
| 脚本内存 | 无 I/O 开销 | 脚本重启后丢失 |
| Sheet3（可选） | 跨脚本实例共享 | 有读写延迟，但可接受 |

---

## 5. API 设计（上线版）

### 5.1 鉴权与用户识别

#### 5.1.1 API Key 设计

**格式**：
```
ky_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
└─前缀──┘└──────── 32位随机字符 ────────────┘

示例：ky_live_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6
```

| 前缀 | 含义 |
|------|------|
| `ky_live_` | 生产环境密钥 |
| `ky_test_` | 测试环境密钥 |

**使用方式**：
```
Header: Authorization: Bearer ky_live_a1b2c3d4e5f6...
```

#### 5.1.2 用户识别机制

> **核心问题**：Scripts 提交的数据如何关联到正确的用户？
> **答案**：通过 API Key 识别用户，脚本无需传递 userId。

```
┌─────────────────────────────────────────────────────────────────┐
│                         请求进入                                 │
│  Authorization: Bearer ky_live_a1b2c3d4e5f6...                  │
└───────────────────────────┬─────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│  1. 提取 API Key                                                 │
│  2. 查缓存（Redis）：apiKeyHash → userId                         │
│     - 命中：直接获取 userId                                      │
│     - 未命中：继续步骤 3                                         │
└───────────────────────────┬─────────────────────────────────────┘
                            │ 缓存未命中
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│  3. 计算 SHA256(API Key)                                        │
│  4. 查数据库：SELECT id FROM users WHERE api_key_hash = ?       │
│     - 匹配：获取 userId，写入缓存（TTL 1小时）                   │
│     - 不匹配：返回 401 UNAUTHORIZED                              │
└───────────────────────────┬─────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│  5. 将 userId 注入请求上下文                                     │
│  6. 后续所有操作自动带 userId 隔离                               │
└─────────────────────────────────────────────────────────────────┘
```

#### 5.1.3 多 MCC 支持

- **一个 API Key 对应一个用户**
- **一个用户可管理多个 MCC**
- **campaignId 全局唯一**，通过 `userId + campaignId` 组合键隔离
- Scripts 只需配置一个 API Key，无需传递 userId

```
┌─────────────────────────────────────────────────────────────────┐
│                          User                                    │
│  id: user_123                                                    │
│  api_key_hash: xxx                                               │
└───────────────────────────┬─────────────────────────────────────┘
                            │ 1:N
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                     CampaignMeta                                 │
│  userId: user_123                                                │
│  campaignId: 111  │  mccId: MCC-A  │  cid: CID-1               │
│  campaignId: 222  │  mccId: MCC-A  │  cid: CID-2               │
│  campaignId: 333  │  mccId: MCC-B  │  cid: CID-3               │
└─────────────────────────────────────────────────────────────────┘
```

#### 5.1.4 脚本端配置（极简）

```javascript
// Scripts 配置：只需一个 API Key
const CONFIG = {
  API_KEY: 'ky_live_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6',
  API_BASE_URL: 'https://api.kyads.com'
};

// 所有 API 调用自动带上 Authorization 头
function callApi(endpoint, data) {
  return UrlFetchApp.fetch(CONFIG.API_BASE_URL + endpoint, {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + CONFIG.API_KEY,
      'Content-Type': 'application/json'
    },
    payload: JSON.stringify(data)
  });
}
```

#### 5.1.5 安全性设计

| 风险 | 防护措施 |
|------|----------|
| API Key 泄露 | 支持 Key 轮换（一键重置）；审计日志追踪异常调用 |
| 暴力破解 | Rate Limit（每 IP 每分钟 100 次）；失败次数限制 |
| 传输安全 | 强制 HTTPS |
| 存储安全 | 数据库只存 hash，不存明文 |
| 越权访问 | 所有数据库查询自动带 `userId` 条件 |

### 5.2 POST `/v1/suffix/lease`

用途：上报 `nowClicks` 并获取“是否应换链”的决策；若需换链则领取 1 条 suffix（幂等、可重试）。

请求 Body：
- `campaignId: string`（必填）
- `nowClicks: number`（必填，TODAY）
- `observedAt: string`（必填，ISO8601）
- `scriptInstanceId: string`（必填，例如 Script-A/Script-B）
- `cycleMinutes: number`（必填）
- `windowStartEpochSeconds: number`（必填）
- `idempotencyKey: string`（必填）

响应（200）：
- `action: "APPLY" | "NOOP"`
- `leaseId?: string`
- `finalUrlSuffix?: string`
- `reason?: string`

响应（202）：
- `code: "PENDING_IMPORT"`（未知 campaignId 触发异步导入）

响应（409/503）：
- `code: "NO_STOCK"`

响应（401/403/422/429/5xx）：按错误码返回（见 5.6）。

#### lease 语义（关键，不可更改）

- API 保存 `lastAppliedClicks`（上次“成功换链”时 clicks），并据此判定：
  - `delta = nowClicks - lastAppliedClicks`
  - 若 `delta <= 0`：返回 `action=NOOP`。
  - 若 `delta > 0`：
    - 若该 campaign 存在“未 ack 的活跃租约”：**返回同一 leaseId + 同一 finalUrlSuffix**（脚本可重复尝试写入，不额外耗库存）。
    - 若无活跃租约：从库存取 1 条，创建租约并返回 `action=APPLY`。
- **单调递增保护**：`lastObservedClicks = max(lastObservedClicks, nowClicks)`，判定使用 `nowClicksForDecision`（避免数据回落误判）。
- `idempotencyKey` 相同必须返回同一决策/同一租约（或同一 NOOP）。

### 5.2.1 POST `/v1/suffix/lease/batch`（性能优化）

用途：批量上报多个 campaign 的 clicks 并获取决策，**大幅降低 API 调用次数**。

> 背景：单次 lease 逐个调用时，700 个 campaign 需要 700 次请求；批量接口可降至 7 次（每批 100 个）。

请求 Body：
- `campaigns: Array`（必填，最多 100 条）
  - `campaignId: string`
  - `nowClicks: number`
  - `observedAt: string`
  - `windowStartEpochSeconds: number`
  - `idempotencyKey: string`
- `scriptInstanceId: string`（必填）
- `cycleMinutes: number`（必填）

响应（200）：
```json
{
  "results": [
    { "campaignId": "123", "action": "NOOP", "reason": "delta<=0" },
    { "campaignId": "456", "action": "APPLY", "leaseId": "...", "finalUrlSuffix": "..." },
    { "campaignId": "789", "code": "NO_STOCK" },
    { "campaignId": "999", "code": "PENDING_IMPORT" }
  ]
}
```

#### batch 语义

- 每个 campaign 独立判定，互不影响。
- 部分失败不影响其他 campaign 的结果返回。
- 单个 campaign 的语义与 5.2 完全一致（幂等、租约机制等）。
- 建议脚本侧先收集所有 campaign 数据，再按批次（每批 ≤100）调用。

### 5.2.2 POST `/v1/suffix/ack/batch`（性能优化）

用途：批量回执多个租约的结果。

请求 Body：
- `acks: Array`（必填，最多 100 条）
  - `leaseId: string`
  - `campaignId: string`
  - `applied: boolean`
  - `appliedAt: string`
  - `errorMessage?: string`

响应（200）：
```json
{
  "results": [
    { "leaseId": "...", "ok": true },
    { "leaseId": "...", "ok": true }
  ]
}
```

### 5.3 POST `/v1/suffix/ack`

用途：脚本写入后回执成功/失败，驱动租约与 clicks 状态推进。

请求 Body：
- `leaseId: string`（必填）
- `campaignId: string`（必填）
- `applied: boolean`（必填）
- `appliedAt: string`（必填，ISO8601）
- `errorMessage?: string`

响应（200）：
- `ok: true`
响应（409）：
- `code: "LEASE_EXPIRED"`（租约已过期并被回收，请重新 lease）

#### ack 语义（关键，不可更改）

- ack 必须幂等：重复 ack 不得改变最终结果。
- 若租约已过期回收：返回 `LEASE_EXPIRED`，脚本需重新 lease。
- 若 `applied=true`：
  - 租约标记为 `consumed`
  - 更新 `lastAppliedClicks = max(lastAppliedClicks, nowClicksAtLeaseTime)`
- 若 `applied=false`：
  - 租约标记为 `failed`（保留失败原因）
  - 该租约仍可被 lease 返回用于重试（直到超时回收或人工处理），避免无限消耗库存

### 5.4 POST `/v1/campaigns/sync`（增量同步）

用途：Scripts 批量上报 Campaign 元数据，后端增量更新 CampaignMeta。

> **背景**：Campaign 元数据只能由 Scripts 从 Google Ads 读取，需同步到后端数据库作为唯一数据源。

请求 Body：
- `campaigns: Array`（必填，最多 200 条）
  - `campaignId: string`
  - `campaignName: string`
  - `country: string`
  - `finalUrl: string`
  - `cid: string`
  - `mccId: string`
- `syncMode: "incremental" | "full"`（必填）
  - `incremental`：仅更新变化的记录
  - `full`：全量替换（会标记未上报的 campaign 为 inactive）

响应（200）：
```json
{
  "ok": true,
  "created": 5,
  "updated": 10,
  "unchanged": 685,
  "warnings": [
    { "campaignId": "456", "message": "finalUrl changed, please check affiliate link config" }
  ]
}
```

#### sync 语义

- **幂等**：相同数据多次同步，结果一致。
- **变化检测**：后端检测 `campaignName`、`country`、`finalUrl` 是否变化。
- **finalUrl 变化告警**：`finalUrl` 变化可能影响联盟链接配置，响应中返回 warning。
- **增量同步**：脚本侧通过 hash 检测变化，仅变化时调用，减少 API 调用量。

### 5.4.1 lease 请求附带 meta（惰性同步）

在 `/v1/suffix/lease` 和 `/v1/suffix/lease/batch` 请求中，可附带 `meta` 字段：

```json
// 单个 lease
{
  "campaignId": "123",
  "nowClicks": 100,
  "observedAt": "2026-01-14T10:00:00Z",
  "meta": {
    "campaignName": "US-Brand-Search",
    "country": "US",
    "finalUrl": "https://example.com/landing",
    "cid": "111-222-3333",
    "mccId": "444-555-6666"
  },
  // ... 其他必填字段
}

// 批量 lease
{
  "campaigns": [
    {
      "campaignId": "123",
      "nowClicks": 100,
      "meta": { ... }  // 可选
    }
  ]
}
```

**惰性同步语义**：
- 后端发现 `campaignId` 不存在时，使用 `meta` 自动创建 CampaignMeta。
- 后端发现 `meta` 与现有数据不一致时，自动更新。
- `meta` 为可选字段，不影响 lease 核心逻辑。
- 作为增量同步的兜底机制，确保不会因为同步遗漏导致 `PENDING_IMPORT`。

### 5.5 POST `/v1/sheet/import`（手动导入）

- 用于从 Sheet1 导入/刷新 CampaignMeta（初始化、防漏、运营入口）。
- 作为增量同步的兜底补充。

### 5.6 错误码（上线最小集合）

- `UNAUTHORIZED`
- `FORBIDDEN`
- `VALIDATION_ERROR`
- `PENDING_IMPORT`
- `NO_STOCK`
- `LEASE_EXPIRED`
- `NO_AFFILIATE_LINK`
- `PROXY_UNAVAILABLE`
- `REDIRECT_TRACK_FAILED`
- `RATE_LIMITED`
- `INTERNAL_ERROR`
- `SYNC_PARTIAL_FAILURE`（sync 接口部分失败）

---

## 6. 数据模型（最小可上线）

### 6.1 User

- `id`：用户唯一标识（UUID）
- `email`：用户邮箱（可选，用于通知）
- `name`：用户名称（可选）
- `apiKeyHash`：API Key 的 SHA256 哈希值（用于验证）
- `apiKeyPrefix`：API Key 前 12 位（如 `ky_live_a1b2`，用于快速定位和日志脱敏显示）
- `apiKeyCreatedAt`：API Key 创建时间
- `spreadsheetId`：绑定的 Google 表格 ID
- `status: "active" | "suspended"`：账户状态
- `createdAt/updatedAt`

**索引**：
- `UNIQUE INDEX idx_api_key_hash (apiKeyHash)`
- `INDEX idx_api_key_prefix (apiKeyPrefix)`

### 6.2 CampaignMeta（唯一数据源）

> **重要**：CampaignMeta 是 Campaign 元数据的唯一数据源，所有业务逻辑基于此表。

- `id`
- `userId`
- `campaignId`（唯一：`userId + campaignId`）
- `campaignName`
- `country`（目标投放国家，用于代理出口选择）
- `finalUrl`（最终到达网址，用于联盟链接配置参考）
- `cid`
- `mccId`
- `status: "active" | "inactive"`（用于标记不再上报的 campaign）
- `lastSyncedAt`（最后同步时间）
- `lastImportedAt`（从表格导入时间，可选）
- `createdAt/updatedAt`

### 6.3 AffiliateLink

- `id`
- `userId`
- `campaignId`
- `url`
- `enabled`
- `priority`
- `createdAt/updatedAt`

### 6.4 SuffixStockItem

- `id`
- `userId`
- `campaignId`
- `finalUrlSuffix`
- `status: "available" | "leased" | "consumed" | "expired" | "invalid"`
- `exitIp`
- `sourceAffiliateLinkId`
- `createdAt`
- `leasedAt?`
- `consumedAt?`
- `expiredAt?`

### 6.5 SuffixLease（强烈建议保留）

- `id`
- `userId`
- `campaignId`
- `suffixStockItemId`
- `idempotencyKey`
- `nowClicksAtLeaseTime`
- `windowStartEpochSeconds`
- `status: "leased" | "consumed" | "failed" | "expired"`
- `leasedAt`
- `ackedAt?`
- `applied?`
- `errorMessage?`

### 6.6 CampaignClickState（新增：一致性状态源）

- `userId`
- `campaignId`
- `lastAppliedClicks`（触发判定基准）
- `lastObservedClicks`（可选，用于观测）
- `lastObservedAt`
- `updatedAt`

---

## 7. 库存与后台任务（上线默认）

- `produceBatchSize = 10`
- `lowWatermark = 3`
- `leaseTtlMinutes = 15`（leased 无 ack 超时回收）
- `suffixTtlHours = 48`（过期清理）
- 触发补货：
  - 实时：每次 lease 命中库存后异步检查低水位
  - 定时：每 5 分钟兜底扫描

---

## 8. 业务规则（BR，最终口径）

### 8.1 换链规则

- **BR-001**：仅 `nowClicks - lastAppliedClicks > 0` 才换链
- **BR-002**：一次触发只换 1 次（不按 delta 次数消耗）
- **BR-003**：仅 CID=active 且 Campaign=enabled
- **BR-004**：多租户隔离：库存/去重/状态均按 `userId` 维度隔离
- **BR-005**：同 campaign 同窗口 + 同 clicks 幂等：相同 `idempotencyKey` 返回同一结果
- **BR-006**：同 campaign 同时仅允许 1 个未 ack 租约；lease 必须返回该租约以支持重试
- **BR-007**：acked 成功才推进 `lastAppliedClicks`
- **BR-008**：leased 超时无 ack 自动回收；suffix 过期清理
- **BR-009**：批量 API 每个 campaign 独立判定，部分失败不影响其他 campaign
- **BR-010**：Hint 预过滤仅作为性能优化，不影响换链决策正确性

### 8.2 数据同步规则

- **BR-011**：**数据库是唯一数据源**：所有业务逻辑（库存生产、lease 判定、代理选择）基于 CampaignMeta 表，不直接读取 Google 表格
- **BR-012**：**表格仅作可视化**：Sheet1 作为运营可视化入口和初始导入来源，不承担业务一致性
- **BR-013**：**增量同步优先**：Scripts 通过 hash 检测 Campaign 数据变化，仅变化时调用 `/v1/campaigns/sync`
- **BR-014**：**惰性同步兜底**：lease 请求可附带 `meta` 字段，后端发现不存在或变化时自动更新
- **BR-015**：**finalUrl 变化告警**：`finalUrl` 变化可能影响联盟链接配置，API 应返回 warning 提示运营核查
- **BR-016**：**执行顺序**：先写表格（可视化优先），再提交后端（业务同步），表格/API 失败互不阻塞

### 8.3 鉴权与安全规则

- **BR-017**：**API Key 唯一标识用户**：通过 API Key 识别用户，脚本无需传递 userId
- **BR-018**：**API Key 只存 hash**：数据库只存储 SHA256 哈希值，不存储明文
- **BR-019**：**自动注入 userId**：所有 API 请求经鉴权后自动注入 userId 到上下文，后续操作自动隔离
- **BR-020**：**一 Key 多 MCC**：一个 API Key 可管理多个 MCC，数据按 userId 隔离
- **BR-021**：**越权防护**：所有数据库查询必须带 `userId` 条件，防止跨用户访问

---

## 9. 非功能需求（NFR，上线最小）

- **性能**：
  - 库存命中时 `lease` P95 < 200ms
  - `lease/batch`（100 条）P95 < 1s
  - `campaigns/sync`（200 条）P95 < 500ms
  - 支持脚本侧 Hint 预过滤，减少无效 lease 调用
  - 支持增量同步，减少无效 sync 调用（Campaign 配置不变时跳过）
- **可靠性**：ack 重试；后台任务可重试（退避）；sync 失败不影响 lease（惰性同步兜底）
- **安全**：API Key 仅存 hash；按 userId 限流与审计日志（必需）
- **可观测**：
  - 每 campaign 的库存量、NO_STOCK 次数、失败率、近 24h 换链次数
  - Campaign 同步状态：最后同步时间、变化次数、finalUrl 变化告警
- **可扩展**：批量 API 支持单次 100-200 条，可水平扩展应对大规模 MCC

