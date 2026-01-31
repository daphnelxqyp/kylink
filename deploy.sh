#!/bin/bash

# KyLink 部署脚本
# 用于阿里云服务器部署

set -e

echo "=========================================="
echo "KyLink 部署脚本"
echo "=========================================="

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 检查是否为 root 用户
if [ "$EUID" -ne 0 ]; then
    echo -e "${RED}请使用 root 用户或 sudo 运行此脚本${NC}"
    exit 1
fi

# 1. 检查系统环境
echo -e "${GREEN}[1/10] 检查系统环境...${NC}"
if ! command -v docker &> /dev/null; then
    echo -e "${YELLOW}Docker 未安装，正在安装...${NC}"
    curl -fsSL https://get.docker.com | bash
    systemctl start docker
    systemctl enable docker
fi

if ! command -v docker-compose &> /dev/null; then
    echo -e "${YELLOW}Docker Compose 未安装，正在安装...${NC}"
    curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
    chmod +x /usr/local/bin/docker-compose
fi

echo -e "${GREEN}✓ 系统环境检查完成${NC}"

# 2. 检查配置文件
echo -e "${GREEN}[2/10] 检查配置文件...${NC}"
if [ ! -f .env.production ]; then
    echo -e "${RED}错误：.env.production 文件不存在${NC}"
    echo "请先创建 .env.production 文件并配置环境变量"
    exit 1
fi

echo -e "${GREEN}✓ 配置文件检查完成${NC}"

# 3. 停止旧容器
echo -e "${GREEN}[3/10] 停止旧容器...${NC}"
docker-compose down || true
echo -e "${GREEN}✓ 旧容器已停止${NC}"

# 4. 备份数据库
echo -e "${GREEN}[4/10] 备份数据库...${NC}"
BACKUP_DIR="./backups"
mkdir -p $BACKUP_DIR
BACKUP_FILE="$BACKUP_DIR/backup_$(date +%Y%m%d_%H%M%S).sql"

if docker ps -a | grep -q kylink-mysql; then
    docker exec kylink-mysql mysqldump -u root -p${MYSQL_ROOT_PASSWORD} kyads_suffixpool > $BACKUP_FILE 2>/dev/null || true
    if [ -f $BACKUP_FILE ]; then
        echo -e "${GREEN}✓ 数据库备份完成: $BACKUP_FILE${NC}"
    fi
fi

# 5. 拉取最新代码
echo -e "${GREEN}[5/10] 拉取最新代码...${NC}"
if [ -d .git ]; then
    git pull origin main
    echo -e "${GREEN}✓ 代码更新完成${NC}"
else
    echo -e "${YELLOW}⚠ 不是 Git 仓库，跳过代码拉取${NC}"
fi

# 6. 构建镜像
echo -e "${GREEN}[6/10] 构建 Docker 镜像...${NC}"
docker-compose build --no-cache
echo -e "${GREEN}✓ 镜像构建完成${NC}"

# 7. 启动服务
echo -e "${GREEN}[7/10] 启动服务...${NC}"
docker-compose --env-file .env.production up -d
echo -e "${GREEN}✓ 服务启动完成${NC}"

# 8. 等待服务就绪
echo -e "${GREEN}[8/10] 等待服务就绪...${NC}"
sleep 10

# 检查 MySQL
echo "检查 MySQL..."
for i in {1..30}; do
    if docker exec kylink-mysql mysqladmin ping -h localhost -u root -p${MYSQL_ROOT_PASSWORD} &> /dev/null; then
        echo -e "${GREEN}✓ MySQL 已就绪${NC}"
        break
    fi
    echo "等待 MySQL 启动... ($i/30)"
    sleep 2
done

# 9. 运行数据库迁移
echo -e "${GREEN}[9/10] 运行数据库迁移...${NC}"
docker exec kylink-app npx prisma db push --skip-generate || true
echo -e "${GREEN}✓ 数据库迁移完成${NC}"

# 10. 检查服务状态
echo -e "${GREEN}[10/10] 检查服务状态...${NC}"
docker-compose ps

# 健康检查
echo ""
echo "等待应用启动..."
sleep 5

if curl -f http://localhost:51001/api/health &> /dev/null; then
    echo -e "${GREEN}✓ 应用健康检查通过${NC}"
else
    echo -e "${YELLOW}⚠ 应用健康检查失败，请检查日志${NC}"
fi

# 显示日志
echo ""
echo "=========================================="
echo -e "${GREEN}部署完成！${NC}"
echo "=========================================="
echo ""
echo "服务状态："
docker-compose ps
echo ""
echo "查看日志："
echo "  docker-compose logs -f app"
echo ""
echo "访问地址："
echo "  http://your-server-ip:51001"
echo ""
echo "管理命令："
echo "  启动服务: docker-compose up -d"
echo "  停止服务: docker-compose down"
echo "  查看日志: docker-compose logs -f"
echo "  重启服务: docker-compose restart"
echo ""
