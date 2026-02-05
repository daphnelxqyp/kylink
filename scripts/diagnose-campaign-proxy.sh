#!/bin/bash
# 在 Docker 容器内运行诊断脚本

CAMPAIGN_ID="${1:-706-LH1-consumercellular-US-1228-83626}"

echo "🔍 在 Docker 容器内诊断 Campaign: $CAMPAIGN_ID"
echo ""

# 检查容器是否运行
if ! docker ps | grep -q kylink; then
  echo "❌ kylink 容器未运行"
  echo "请先启动容器: docker-compose up -d"
  exit 1
fi

# 在容器内执行诊断脚本
docker exec kylink node scripts/diagnose-campaign-proxy.js "$CAMPAIGN_ID"
