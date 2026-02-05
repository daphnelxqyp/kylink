#!/bin/bash
#
# 修复国家代码问题的部署脚本
#
# 问题：数据库中存储的是完整国家名（如 "United States"），
#      导致代理用户名模板中包含空格，认证失败
#
# 解决：添加国家代码标准化函数，自动转换为 ISO 代码（如 "US"）
#

set -e

echo "========================================="
echo "🔧 修复国家代码问题"
echo "========================================="
echo ""

# 检查是否在正确的目录
if [ ! -f "package.json" ]; then
  echo "❌ 错误：请在项目根目录运行此脚本"
  exit 1
fi

echo "📋 步骤 1: 备份当前代码"
BACKUP_DIR="backup-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BACKUP_DIR"
cp -r src "$BACKUP_DIR/"
echo "✅ 备份完成: $BACKUP_DIR"
echo ""

echo "📋 步骤 2: 检查新文件"
if [ ! -f "src/lib/country-codes.ts" ]; then
  echo "❌ 错误：找不到 src/lib/country-codes.ts"
  echo "   请确保已经从 Windows 同步了最新代码"
  exit 1
fi
echo "✅ 新文件存在"
echo ""

echo "📋 步骤 3: 编译项目"
npm run build
echo "✅ 编译成功"
echo ""

echo "📋 步骤 4: 重启服务"
if command -v systemctl &> /dev/null; then
  echo "使用 systemctl 重启..."
  sudo systemctl restart kylink
  sleep 3
  sudo systemctl status kylink --no-pager -l
elif command -v pm2 &> /dev/null; then
  echo "使用 PM2 重启..."
  pm2 restart kylink
  pm2 logs kylink --lines 20
else
  echo "⚠️  未检测到 systemctl 或 PM2，请手动重启服务"
fi
echo "✅ 服务已重启"
echo ""

echo "========================================="
echo "✅ 修复完成！"
echo "========================================="
echo ""
echo "📝 修复内容："
echo "  1. 新增 src/lib/country-codes.ts（200+ 国家映射）"
echo "  2. 修改 src/lib/stock-producer.ts（使用标准化函数）"
echo "  3. 修改 src/lib/suffix-generator.ts（使用标准化函数）"
echo ""
echo "🔍 验证方法："
echo "  1. 查看日志：journalctl -u kylink -f"
echo "  2. 检查代理用户名是否正确（应该是 US 而不是 UNITED STATES）"
echo "  3. 在管理后台触发补货，观察是否还有认证失败"
echo ""
echo "💡 如果还有问题："
echo "  1. 检查数据库中 CampaignMeta.country 字段的值"
echo "  2. 运行诊断脚本：node scripts/diagnose-campaign-proxy.js <campaignId>"
echo ""
