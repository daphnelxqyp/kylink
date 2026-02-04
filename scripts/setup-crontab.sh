#!/bin/bash
#
# KyLink Crontab 安装脚本
#
# 用法：
#   sudo ./scripts/setup-crontab.sh
#
# 前提：
#   - 已在 /etc/kylink/kylink.env 中配置 CRON_SECRET
#   - KyLink 服务已运行在 127.0.0.1:51001
#

set -e

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}=== KyLink Crontab 安装脚本 ===${NC}"

# 从环境文件读取 CRON_SECRET
ENV_FILE="/etc/kylink/kylink.env"
if [ -f "$ENV_FILE" ]; then
    CRON_SECRET=$(grep -E '^CRON_SECRET=' "$ENV_FILE" | cut -d'=' -f2- | tr -d '"')
fi

if [ -z "$CRON_SECRET" ]; then
    echo -e "${RED}错误: 未找到 CRON_SECRET${NC}"
    echo "请在 $ENV_FILE 中配置 CRON_SECRET"
    exit 1
fi

echo -e "${GREEN}✓ 已读取 CRON_SECRET${NC}"

# 日志文件
LOG_FILE="/var/log/kylink-cron.log"

# 确保日志文件存在且可写
touch "$LOG_FILE"
chmod 644 "$LOG_FILE"

# 定义 crontab 内容
CRON_CONTENT="# KyLink 定时任务 - 自动生成于 $(date '+%Y-%m-%d %H:%M:%S')
# 每 10 分钟：库存补货
*/10 * * * * curl -fsS -X POST http://127.0.0.1:51001/api/v1/jobs -H \"X-Cron-Secret: ${CRON_SECRET}\" -H \"Content-Type: application/json\" -d '{\"jobName\":\"stock_replenish\"}' >> ${LOG_FILE} 2>&1

# 每 10 分钟：监控告警（错开 30 秒执行）
*/10 * * * * sleep 30 && curl -fsS -X POST http://127.0.0.1:51001/api/v1/jobs -H \"X-Cron-Secret: ${CRON_SECRET}\" -H \"Content-Type: application/json\" -d '{\"jobName\":\"monitoring_alert\"}' >> ${LOG_FILE} 2>&1
"

# 备份现有 crontab
EXISTING_CRON=$(crontab -l 2>/dev/null || true)

# 移除旧的 KyLink crontab 条目
CLEANED_CRON=$(echo "$EXISTING_CRON" | grep -v "KyLink" | grep -v "stock_replenish" | grep -v "monitoring_alert" | grep -v "^$" || true)

# 合并新旧内容
if [ -n "$CLEANED_CRON" ]; then
    NEW_CRON="${CLEANED_CRON}

${CRON_CONTENT}"
else
    NEW_CRON="$CRON_CONTENT"
fi

# 写入 crontab
echo "$NEW_CRON" | crontab -

echo -e "${GREEN}✓ Crontab 已配置${NC}"

# 显示当前 crontab
echo ""
echo -e "${YELLOW}当前 crontab 内容：${NC}"
crontab -l

# 配置 logrotate
LOGROTATE_CONF="/etc/logrotate.d/kylink-cron"
cat > "$LOGROTATE_CONF" << 'EOF'
/var/log/kylink-cron.log {
    daily
    rotate 7
    compress
    missingok
    notifempty
}
EOF

echo ""
echo -e "${GREEN}✓ Logrotate 已配置${NC}"

# 测试任务
echo ""
echo -e "${YELLOW}测试定时任务...${NC}"
RESPONSE=$(curl -fsS -X POST http://127.0.0.1:51001/api/v1/jobs \
    -H "X-Cron-Secret: ${CRON_SECRET}" \
    -H "Content-Type: application/json" \
    -d '{"jobName":"stock_replenish"}' 2>&1 || echo "FAILED")

if echo "$RESPONSE" | grep -q '"success":true'; then
    echo -e "${GREEN}✓ 补货任务测试成功${NC}"
else
    echo -e "${RED}✗ 补货任务测试失败: $RESPONSE${NC}"
fi

echo ""
echo -e "${GREEN}=== 安装完成 ===${NC}"
echo ""
echo "查看日志: tail -f $LOG_FILE"
echo "查看 crontab: crontab -l"
