#!/bin/bash
#
# 代理诊断脚本
# 用于排查 "NO_PROXY_AVAILABLE: 所有代理均不可用" 问题
#
# 使用方法：
#   1. SSH 登录到服务器
#   2. 进入项目目录: cd /root/kylink
#   3. 运行此脚本: bash scripts/diagnose-proxy.sh
#

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "========================================"
echo "      代理诊断脚本"
echo "========================================"
echo ""

# 检查是否加载了环境变量
if [ -z "$DATABASE_URL" ]; then
    echo -e "${YELLOW}正在加载环境变量...${NC}"
    if [ -f .env.production ]; then
        export $(grep -v '^#' .env.production | xargs)
        echo -e "${GREEN}✓ 已加载 .env.production${NC}"
    elif [ -f .env ]; then
        export $(grep -v '^#' .env | xargs)
        echo -e "${GREEN}✓ 已加载 .env${NC}"
    else
        echo -e "${RED}✗ 未找到环境变量文件${NC}"
        exit 1
    fi
fi

echo ""
echo "【步骤 1】检查数据库连接..."
if mysql -u kylink -p"${MYSQL_PASSWORD}" -e "SELECT 1" kyads_suffixpool > /dev/null 2>&1; then
    echo -e "${GREEN}✓ 数据库连接正常${NC}"
else
    # 尝试 Docker 环境的 mysql 连接
    if docker exec kylink-mysql mysql -u kylink -p"${MYSQL_PASSWORD}" -e "SELECT 1" kyads_suffixpool > /dev/null 2>&1; then
        echo -e "${GREEN}✓ 数据库连接正常（Docker）${NC}"
        MYSQL_CMD="docker exec kylink-mysql mysql -u kylink -p${MYSQL_PASSWORD} kyads_suffixpool"
    else
        echo -e "${RED}✗ 数据库连接失败${NC}"
        echo "   请检查数据库配置"
        exit 1
    fi
fi

# 默认使用本地 mysql 命令
MYSQL_CMD="${MYSQL_CMD:-mysql -u kylink -p${MYSQL_PASSWORD} kyads_suffixpool}"

echo ""
echo "【步骤 2】检查代理供应商配置..."
echo ""

PROVIDERS=$($MYSQL_CMD -N -e "
    SELECT id, name, host, port, enabled, usernameTemplate, 
           CASE WHEN password IS NOT NULL AND password != '' THEN 'YES' ELSE 'NO' END as hasPassword
    FROM ProxyProvider 
    WHERE deletedAt IS NULL;
" 2>/dev/null)

if [ -z "$PROVIDERS" ]; then
    echo -e "${RED}✗ 数据库中没有任何代理供应商！${NC}"
    echo "   请先在管理后台添加代理供应商。"
    exit 1
fi

echo "找到以下代理供应商："
echo "$PROVIDERS" | while IFS=$'\t' read -r id name host port enabled template hasPassword; do
    if [ "$enabled" = "1" ]; then
        status="${GREEN}✓ 启用${NC}"
    else
        status="${RED}✗ 禁用${NC}"
    fi
    echo -e "   - $name ($host:$port)"
    echo -e "     状态: $status"
    echo -e "     用户名模板: ${template:-无}"
    echo -e "     密码配置: $hasPassword"
    echo ""
done

echo ""
echo "【步骤 3】检查用户代理分配..."
echo ""

USERS_WITH_PROXY=$($MYSQL_CMD -N -e "
    SELECT u.id, u.name, u.email, COUNT(ppu.id) as proxyCount
    FROM User u
    LEFT JOIN ProxyProviderUser ppu ON u.id = ppu.userId
    LEFT JOIN ProxyProvider pp ON ppu.proxyProviderId = pp.id AND pp.enabled = 1 AND pp.deletedAt IS NULL
    WHERE u.deletedAt IS NULL
    GROUP BY u.id, u.name, u.email;
" 2>/dev/null)

echo "用户代理分配情况："
echo "$USERS_WITH_PROXY" | while IFS=$'\t' read -r id name email count; do
    if [ "$count" -gt 0 ]; then
        status="${GREEN}✓ $count 个代理${NC}"
    else
        status="${RED}✗ 未分配${NC}"
    fi
    echo -e "   - ${name:-${email:-$id}}: $status"
done

echo ""
echo "【步骤 4】测试代理连接..."
echo ""

# 获取第一个启用的代理
FIRST_PROXY=$($MYSQL_CMD -N -e "
    SELECT host, port, usernameTemplate, password
    FROM ProxyProvider 
    WHERE enabled = 1 AND deletedAt IS NULL
    ORDER BY priority ASC
    LIMIT 1;
" 2>/dev/null)

if [ -n "$FIRST_PROXY" ]; then
    IFS=$'\t' read -r host port template password <<< "$FIRST_PROXY"
    
    echo "测试代理: $host:$port"
    
    # TCP 连接测试
    echo -n "   TCP 连接测试... "
    if timeout 5 bash -c "echo > /dev/tcp/$host/$port" 2>/dev/null; then
        echo -e "${GREEN}✓ 成功${NC}"
    else
        echo -e "${RED}✗ 失败${NC}"
        echo "   代理服务器可能不可达，请检查网络或代理地址"
    fi
    
    # 如果有 curl 且代理支持 SOCKS5，尝试通过代理访问
    if command -v curl &> /dev/null; then
        echo -n "   SOCKS5 代理测试... "
        
        # 处理用户名模板（简单替换）
        username=$(echo "$template" | sed "s/{COUNTRY}/US/g" | sed "s/{country}/us/g" | sed "s/{session:[0-9]*}/$(date +%s)/g")
        
        if [ -n "$username" ] && [ -n "$password" ]; then
            proxy_url="socks5://${username}:${password}@${host}:${port}"
        else
            proxy_url="socks5://${host}:${port}"
        fi
        
        # 尝试通过代理访问
        result=$(curl -s --max-time 10 --proxy "$proxy_url" http://httpbin.org/ip 2>&1)
        
        if echo "$result" | grep -q "origin"; then
            ip=$(echo "$result" | grep -o '"origin": "[^"]*"' | cut -d'"' -f4)
            echo -e "${GREEN}✓ 成功 (出口IP: $ip)${NC}"
        else
            echo -e "${RED}✗ 失败${NC}"
            echo "   错误信息: $result"
            echo ""
            echo -e "${YELLOW}可能的原因：${NC}"
            echo "   1. 代理用户名或密码错误"
            echo "   2. 代理服务不支持 SOCKS5 协议"
            echo "   3. 代理账户已过期或被限制"
        fi
    fi
else
    echo -e "${RED}✗ 没有启用的代理供应商${NC}"
fi

echo ""
echo "========================================"
echo "诊断完成"
echo "========================================"
echo ""
echo "如果仍有问题，请检查："
echo "1. 确认用户已被分配代理供应商"
echo "2. 检查代理用户名模板格式是否正确"
echo "3. 验证代理账户状态是否正常"
echo "4. 查看应用日志获取更多信息: pm2 logs kylink"
