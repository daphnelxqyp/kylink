-- =====================================================
-- KyAds SuffixPool 数据库 Schema
-- 版本: 1.0
-- 日期: 2026-01-14
-- 说明: 用于 Prisma schema 生成的 SQL 文件
-- =====================================================

-- -----------------------------------------------------
-- 1. User 表 - 用户信息
-- -----------------------------------------------------
CREATE TABLE "User" (
    "id"               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "email"            VARCHAR(255),
    "name"             VARCHAR(255),
    "apiKeyHash"       VARCHAR(64) NOT NULL,           -- SHA256 哈希值（64位十六进制）
    "apiKeyPrefix"     VARCHAR(16) NOT NULL,           -- API Key 前缀，如 ky_live_a1b2
    "apiKeyCreatedAt"  TIMESTAMP WITH TIME ZONE,
    "passwordHash"     VARCHAR(128),                  -- 密码哈希
    "passwordSalt"     VARCHAR(32),                   -- 密码盐
    "spreadsheetId"    VARCHAR(255),                   -- 绑定的 Google 表格 URL
    "status"           VARCHAR(20) NOT NULL DEFAULT 'active',  -- active | suspended
    "createdAt"        TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedAt"        TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

    CONSTRAINT "User_apiKeyHash_unique" UNIQUE ("apiKeyHash")
);

-- User 表索引
CREATE INDEX "User_apiKeyPrefix_idx" ON "User" ("apiKeyPrefix");
CREATE INDEX "User_status_idx" ON "User" ("status");

COMMENT ON TABLE "User" IS '用户表 - 存储用户信息和API密钥';
COMMENT ON COLUMN "User"."apiKeyHash" IS 'API Key 的 SHA256 哈希值，用于验证';
COMMENT ON COLUMN "User"."apiKeyPrefix" IS 'API Key 前 12-16 位，用于快速定位和日志脱敏显示';
COMMENT ON COLUMN "User"."status" IS '账户状态: active-正常, suspended-已暂停';


-- -----------------------------------------------------
-- 2. CampaignMeta 表 - Campaign 元数据（唯一数据源）
-- -----------------------------------------------------
CREATE TABLE "CampaignMeta" (
    "id"               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "userId"           UUID NOT NULL,
    "campaignId"       VARCHAR(64) NOT NULL,           -- Google Ads Campaign ID（全局唯一）
    "campaignName"     VARCHAR(500),                   -- 广告系列名称
    "country"          VARCHAR(10),                    -- 目标投放国家，如 US, UK
    "finalUrl"         TEXT,                           -- 最终到达网址
    "cid"              VARCHAR(32) NOT NULL,           -- 子账号 CID
    "mccId"            VARCHAR(32) NOT NULL,           -- MCC ID
    "status"           VARCHAR(20) NOT NULL DEFAULT 'active',  -- active | inactive
    "lastSyncedAt"     TIMESTAMP WITH TIME ZONE,       -- 最后同步时间
    "lastImportedAt"   TIMESTAMP WITH TIME ZONE,       -- 从表格导入时间
    "createdAt"        TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedAt"        TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

    CONSTRAINT "CampaignMeta_userId_campaignId_unique" UNIQUE ("userId", "campaignId"),
    CONSTRAINT "CampaignMeta_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE
);

-- CampaignMeta 表索引
CREATE INDEX "CampaignMeta_userId_idx" ON "CampaignMeta" ("userId");
CREATE INDEX "CampaignMeta_campaignId_idx" ON "CampaignMeta" ("campaignId");
CREATE INDEX "CampaignMeta_status_idx" ON "CampaignMeta" ("status");
CREATE INDEX "CampaignMeta_mccId_idx" ON "CampaignMeta" ("mccId");
CREATE INDEX "CampaignMeta_cid_idx" ON "CampaignMeta" ("cid");

COMMENT ON TABLE "CampaignMeta" IS 'Campaign 元数据表 - 唯一数据源，所有业务逻辑基于此表';
COMMENT ON COLUMN "CampaignMeta"."country" IS '目标投放国家，用于代理出口选择';
COMMENT ON COLUMN "CampaignMeta"."finalUrl" IS '最终到达网址，用于联盟链接配置参考';
COMMENT ON COLUMN "CampaignMeta"."status" IS 'active-活跃, inactive-不再上报的campaign';


-- -----------------------------------------------------
-- 3. AffiliateLink 表 - 联盟链接
-- -----------------------------------------------------
CREATE TABLE "AffiliateLink" (
    "id"               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "userId"           UUID NOT NULL,
    "campaignId"       VARCHAR(64) NOT NULL,           -- 关联的 Campaign ID
    "url"              TEXT NOT NULL,                  -- 联盟入口链接
    "enabled"          BOOLEAN NOT NULL DEFAULT true,
    "priority"         INTEGER NOT NULL DEFAULT 0,     -- 优先级，数值越大优先级越高
    "createdAt"        TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedAt"        TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

    CONSTRAINT "AffiliateLink_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE
);

-- AffiliateLink 表索引
CREATE INDEX "AffiliateLink_userId_idx" ON "AffiliateLink" ("userId");
CREATE INDEX "AffiliateLink_campaignId_idx" ON "AffiliateLink" ("campaignId");
CREATE INDEX "AffiliateLink_userId_campaignId_idx" ON "AffiliateLink" ("userId", "campaignId");
CREATE INDEX "AffiliateLink_enabled_idx" ON "AffiliateLink" ("enabled");

COMMENT ON TABLE "AffiliateLink" IS '联盟链接表 - 每个Campaign可配置1~N条联盟入口链接';


-- -----------------------------------------------------
-- 4. SuffixStockItem 表 - Suffix 库存项
-- -----------------------------------------------------
CREATE TABLE "SuffixStockItem" (
    "id"                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "userId"                 UUID NOT NULL,
    "campaignId"             VARCHAR(64) NOT NULL,
    "finalUrlSuffix"         TEXT NOT NULL,             -- 可直接写入的 finalUrlSuffix
    "status"                 VARCHAR(20) NOT NULL DEFAULT 'available',  -- available | leased | consumed | expired | invalid
    "exitIp"                 VARCHAR(45),               -- 代理出口 IP（支持 IPv6）
    "sourceAffiliateLinkId"  UUID,                      -- 来源联盟链接 ID
    "createdAt"              TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "leasedAt"               TIMESTAMP WITH TIME ZONE,  -- 被租用时间
    "consumedAt"             TIMESTAMP WITH TIME ZONE,  -- 被消费时间
    "expiredAt"              TIMESTAMP WITH TIME ZONE,  -- 过期时间

    CONSTRAINT "SuffixStockItem_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE,
    CONSTRAINT "SuffixStockItem_sourceAffiliateLinkId_fkey" FOREIGN KEY ("sourceAffiliateLinkId") REFERENCES "AffiliateLink"("id") ON DELETE SET NULL
);

-- SuffixStockItem 表索引
CREATE INDEX "SuffixStockItem_userId_idx" ON "SuffixStockItem" ("userId");
CREATE INDEX "SuffixStockItem_campaignId_idx" ON "SuffixStockItem" ("campaignId");
CREATE INDEX "SuffixStockItem_userId_campaignId_idx" ON "SuffixStockItem" ("userId", "campaignId");
CREATE INDEX "SuffixStockItem_status_idx" ON "SuffixStockItem" ("status");
-- 复合索引：用于快速查找可用库存
CREATE INDEX "SuffixStockItem_userId_campaignId_status_idx" ON "SuffixStockItem" ("userId", "campaignId", "status");
-- 用于超时回收的索引
CREATE INDEX "SuffixStockItem_status_leasedAt_idx" ON "SuffixStockItem" ("status", "leasedAt") WHERE "status" = 'leased';
-- 用于过期清理的索引
CREATE INDEX "SuffixStockItem_status_createdAt_idx" ON "SuffixStockItem" ("status", "createdAt") WHERE "status" = 'available';

COMMENT ON TABLE "SuffixStockItem" IS 'Suffix 库存表 - 存储已追踪好的可直接写入的 finalUrlSuffix';
COMMENT ON COLUMN "SuffixStockItem"."status" IS 'available-可用, leased-已租用, consumed-已消费, expired-已过期, invalid-无效';
COMMENT ON COLUMN "SuffixStockItem"."exitIp" IS '代理出口IP，用于去重（24小时内同Campaign不重复使用同一出口）';


-- -----------------------------------------------------
-- 5. SuffixLease 表 - Suffix 租约
-- -----------------------------------------------------
CREATE TABLE "SuffixLease" (
    "id"                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "userId"                   UUID NOT NULL,
    "campaignId"               VARCHAR(64) NOT NULL,
    "suffixStockItemId"        UUID NOT NULL,
    "idempotencyKey"           VARCHAR(128) NOT NULL,    -- campaignId:windowStartEpochSeconds
    "nowClicksAtLeaseTime"     INTEGER NOT NULL,         -- 租用时的 nowClicks
    "windowStartEpochSeconds"  BIGINT NOT NULL,          -- 窗口开始时间戳
    "status"                   VARCHAR(20) NOT NULL DEFAULT 'leased',  -- leased | consumed | failed | expired
    "leasedAt"                 TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "ackedAt"                  TIMESTAMP WITH TIME ZONE, -- 回执时间
    "applied"                  BOOLEAN,                  -- 是否成功写入
    "errorMessage"             TEXT,                     -- 失败原因

    CONSTRAINT "SuffixLease_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE,
    CONSTRAINT "SuffixLease_suffixStockItemId_fkey" FOREIGN KEY ("suffixStockItemId") REFERENCES "SuffixStockItem"("id") ON DELETE RESTRICT
);

-- SuffixLease 表索引
CREATE INDEX "SuffixLease_userId_idx" ON "SuffixLease" ("userId");
CREATE INDEX "SuffixLease_campaignId_idx" ON "SuffixLease" ("campaignId");
CREATE INDEX "SuffixLease_userId_campaignId_idx" ON "SuffixLease" ("userId", "campaignId");
-- 幂等键索引（用于快速查找同一窗口的租约）
CREATE UNIQUE INDEX "SuffixLease_userId_idempotencyKey_unique" ON "SuffixLease" ("userId", "idempotencyKey");
CREATE INDEX "SuffixLease_status_idx" ON "SuffixLease" ("status");
-- 用于查找活跃租约
CREATE INDEX "SuffixLease_userId_campaignId_status_idx" ON "SuffixLease" ("userId", "campaignId", "status") WHERE "status" = 'leased';
-- 用于超时回收
CREATE INDEX "SuffixLease_status_leasedAt_idx" ON "SuffixLease" ("status", "leasedAt") WHERE "status" = 'leased';

COMMENT ON TABLE "SuffixLease" IS 'Suffix 租约表 - 记录每次换链的租约状态';
COMMENT ON COLUMN "SuffixLease"."idempotencyKey" IS '幂等键，格式: campaignId:windowStartEpochSeconds';
COMMENT ON COLUMN "SuffixLease"."status" IS 'leased-已租用, consumed-已消费, failed-失败, expired-已过期';


-- -----------------------------------------------------
-- 6. CampaignClickState 表 - Campaign 点击状态（一致性状态源）
-- -----------------------------------------------------
CREATE TABLE "CampaignClickState" (
    "userId"              UUID NOT NULL,
    "campaignId"          VARCHAR(64) NOT NULL,
    "lastAppliedClicks"   INTEGER NOT NULL DEFAULT 0,   -- 上次成功换链时的 clicks（触发判定基准）
    "lastObservedClicks"  INTEGER,                      -- 最后观测到的 clicks（可选）
    "lastObservedAt"      TIMESTAMP WITH TIME ZONE,     -- 最后观测时间
    "updatedAt"           TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

    PRIMARY KEY ("userId", "campaignId"),
    CONSTRAINT "CampaignClickState_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE
);

-- CampaignClickState 表索引
CREATE INDEX "CampaignClickState_userId_idx" ON "CampaignClickState" ("userId");

COMMENT ON TABLE "CampaignClickState" IS 'Campaign 点击状态表 - 存储换链判定所需的一致性状态';
COMMENT ON COLUMN "CampaignClickState"."lastAppliedClicks" IS '上次成功换链时的clicks，用于计算delta判定是否需要换链';


-- -----------------------------------------------------
-- 7. ProxyExitIpUsage 表 - 代理出口 IP 使用记录（可选，用于去重）
-- -----------------------------------------------------
CREATE TABLE "ProxyExitIpUsage" (
    "id"           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "userId"       UUID NOT NULL,
    "campaignId"   VARCHAR(64) NOT NULL,
    "exitIp"       VARCHAR(45) NOT NULL,               -- 出口 IP
    "usedAt"       TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "expiresAt"    TIMESTAMP WITH TIME ZONE NOT NULL,  -- 去重过期时间（24小时后）

    CONSTRAINT "ProxyExitIpUsage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE
);

-- ProxyExitIpUsage 表索引
CREATE INDEX "ProxyExitIpUsage_userId_campaignId_idx" ON "ProxyExitIpUsage" ("userId", "campaignId");
CREATE INDEX "ProxyExitIpUsage_userId_campaignId_exitIp_idx" ON "ProxyExitIpUsage" ("userId", "campaignId", "exitIp");
-- 用于清理过期记录
CREATE INDEX "ProxyExitIpUsage_expiresAt_idx" ON "ProxyExitIpUsage" ("expiresAt");

COMMENT ON TABLE "ProxyExitIpUsage" IS '代理出口IP使用记录 - 用于24小时内同Campaign不重复使用同一出口IP';


-- -----------------------------------------------------
-- 8. AuditLog 表 - 审计日志（可选，用于安全追踪）
-- -----------------------------------------------------
CREATE TABLE "AuditLog" (
    "id"           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "userId"       UUID,
    "action"       VARCHAR(64) NOT NULL,               -- 操作类型：lease, ack, sync, import 等
    "resourceType" VARCHAR(64),                        -- 资源类型：campaign, suffix 等
    "resourceId"   VARCHAR(128),                       -- 资源 ID
    "metadata"     JSONB,                              -- 额外元数据
    "ipAddress"    VARCHAR(45),                        -- 请求 IP
    "userAgent"    TEXT,                               -- User-Agent
    "statusCode"   INTEGER,                            -- 响应状态码
    "createdAt"    TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

    CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL
);

-- AuditLog 表索引
CREATE INDEX "AuditLog_userId_idx" ON "AuditLog" ("userId");
CREATE INDEX "AuditLog_action_idx" ON "AuditLog" ("action");
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog" ("createdAt");
CREATE INDEX "AuditLog_userId_action_createdAt_idx" ON "AuditLog" ("userId", "action", "createdAt");

COMMENT ON TABLE "AuditLog" IS '审计日志表 - 记录关键操作用于安全追踪';


-- -----------------------------------------------------
-- 9. 自动更新 updatedAt 触发器函数
-- -----------------------------------------------------
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW."updatedAt" = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- 为需要自动更新的表添加触发器
CREATE TRIGGER update_user_updated_at
    BEFORE UPDATE ON "User"
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_campaign_meta_updated_at
    BEFORE UPDATE ON "CampaignMeta"
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_affiliate_link_updated_at
    BEFORE UPDATE ON "AffiliateLink"
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_campaign_click_state_updated_at
    BEFORE UPDATE ON "CampaignClickState"
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();


-- =====================================================
-- 初始化说明
-- =====================================================
-- 1. 本 SQL 文件基于 PostgreSQL 语法
-- 2. 使用 gen_random_uuid() 生成 UUID（需要 PostgreSQL 13+）
-- 3. 所有时间戳使用带时区的 TIMESTAMP WITH TIME ZONE
-- 4. 枚举类型使用 VARCHAR + CHECK 约束，便于 Prisma 映射
-- 5. 索引设计考虑了主要查询场景：
--    - 按 userId 隔离查询
--    - 按 campaignId 查找
--    - 按 status 过滤
--    - 幂等键查询
--    - 超时回收和过期清理
-- =====================================================

