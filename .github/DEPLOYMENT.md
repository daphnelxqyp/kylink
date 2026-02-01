# 阿里云服务器部署指南

本指南详细说明如何将 KyLink 项目部署到阿里云服务器。

## 📋 目录

- [服务器要求](#服务器要求)
- [部署前准备](#部署前准备)
- [快速部署](#快速部署)
- [详细部署步骤](#详细部署步骤)
- [SSL 证书配置](#ssl-证书配置)
- [监控和维护](#监控和维护)
- [故障排查](#故障排查)

---

## 🖥️ 服务器要求

### 最低配置

- **CPU**: 2 核
- **内存**: 4GB
- **硬盘**: 40GB SSD
- **带宽**: 3Mbps
- **操作系统**: Ubuntu 20.04 LTS / CentOS 7+

### 推荐配置

- **CPU**: 4 核
- **内存**: 8GB
- **硬盘**: 80GB SSD
- **带宽**: 5Mbps
- **操作系统**: Ubuntu 22.04 LTS

---

## 🔧 部署前准备

### 1. 购买阿里云服务器

1. 登录 [阿里云控制台](https://ecs.console.aliyun.com/)
2. 购买 ECS 实例
3. 配置安全组规则：
   - 开放端口：80 (HTTP)
   - 开放端口：443 (HTTPS)
   - 开放端口：51001 (应用端口，可选)
   - 开放端口：22 (SSH)

### 2. 配置域名（可选）

1. 在阿里云购买域名
2. 配置 DNS 解析：
   - 类型：A
   - 主机记录：@ 或 www
   - 记录值：服务器公网 IP

### 3. 准备本地环境

```bash
# 确保已安装 Git
git --version

# 确保代码已提交
cd C:\Users\Administrator\Desktop\kylink
git status
git add .
git commit -m "chore: prepare for production deployment"
git push origin main
```

---

## 🚀 快速部署

### 方式一：使用部署脚本（推荐）

```bash
# 1. SSH 连接到服务器
ssh root@your-server-ip

# 2. 克隆代码
git clone https://github.com/daphnelxqyp/kylink.git
cd kylink

# 3. 配置环境变量
cp .env.production .env
nano .env  # 编辑配置文件

# 4. 运行部署脚本
chmod +x deploy.sh
./deploy.sh
```

### 方式二：手动部署

参见 [详细部署步骤](#详细部署步骤)

---

## 📝 详细部署步骤

### 步骤 1：连接服务器

```bash
# 使用 SSH 连接
ssh root@your-server-ip

# 或使用密钥连接
ssh -i /path/to/your-key.pem root@your-server-ip
```

### 步骤 2：安装 Docker 和 Docker Compose

```bash
# 安装 Docker
curl -fsSL https://get.docker.com | bash

# 启动 Docker
systemctl start docker
systemctl enable docker

# 安装 Docker Compose
curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
chmod +x /usr/local/bin/docker-compose

# 验证安装
docker --version
docker-compose --version
```

### 步骤 3：克隆代码

```bash
# 克隆仓库
git clone https://github.com/daphnelxqyp/kylink.git
cd kylink

# 或者使用 SSH
git clone git@github.com:daphnelxqyp/kylink.git
cd kylink
```

### 步骤 4：配置环境变量

```bash
# 复制环境变量模板
cp .env.production .env

# 编辑环境变量
nano .env
```

**必须修改的配置：**

```bash
# MySQL 密码（必须修改）
MYSQL_ROOT_PASSWORD=your-strong-root-password-here
MYSQL_PASSWORD=your-strong-password-here

# NextAuth 密钥（必须修改，至少 32 字符）
NEXTAUTH_SECRET="your-nextauth-secret-at-least-32-characters-long"

# 域名配置（必须修改）
NEXTAUTH_URL="https://your-domain.com"
NEXT_PUBLIC_API_BASE_URL="https://your-domain.com"

# 定时任务密钥（必须修改）
CRON_SECRET="your-cron-secret-here"

# 代理配置（如果有）
PROXY_API_URL="your-proxy-api-url"
PROXY_API_KEY="your-proxy-api-key"
```

**生成安全密钥：**

```bash
# 生成 NEXTAUTH_SECRET
openssl rand -base64 32

# 生成 CRON_SECRET
openssl rand -hex 32
```

### 步骤 5：配置 Nginx

```bash
# 编辑 Nginx 配置
nano nginx/conf.d/kylink.conf

# 修改域名
# 将 your-domain.com 替换为你的实际域名
```

### 步骤 6：构建和启动服务

```bash
# 构建 Docker 镜像
docker-compose build

# 启动服务
docker-compose up -d

# 查看服务状态
docker-compose ps

# 查看日志
docker-compose logs -f
```

### 步骤 7：运行数据库迁移

```bash
# 等待 MySQL 启动（约 30 秒）
sleep 30

# 运行数据库迁移
docker exec kylink-app npx prisma db push

# 创建管理员用户
docker exec -it kylink-app npx ts-node --compiler-options '{"module":"commonjs"}' scripts/create-admin.ts
```

### 步骤 8：验证部署

```bash
# 检查服务状态
docker-compose ps

# 测试健康检查
curl http://localhost:51001/api/health

# 测试 Nginx
curl http://localhost/health
```

---

## 🔒 SSL 证书配置

### 方式一：使用 Let's Encrypt（免费，推荐）

```bash
# 1. 安装 Certbot
apt-get update
apt-get install certbot

# 2. 停止 Nginx
docker-compose stop nginx

# 3. 获取证书
certbot certonly --standalone -d your-domain.com -d www.your-domain.com

# 4. 复制证书到项目目录
cp /etc/letsencrypt/live/your-domain.com/fullchain.pem nginx/ssl/
cp /etc/letsencrypt/live/your-domain.com/privkey.pem nginx/ssl/

# 5. 重启 Nginx
docker-compose start nginx

# 6. 设置自动续期
echo "0 0 1 * * certbot renew --quiet && cp /etc/letsencrypt/live/your-domain.com/*.pem /path/to/kylink/nginx/ssl/ && docker-compose restart nginx" | crontab -
```

### 方式二：使用阿里云 SSL 证书

1. 在阿里云控制台申请免费 SSL 证书
2. 下载 Nginx 格式证书
3. 上传到服务器：
   ```bash
   scp fullchain.pem root@your-server-ip:/path/to/kylink/nginx/ssl/
   scp privkey.pem root@your-server-ip:/path/to/kylink/nginx/ssl/
   ```
4. 重启 Nginx：
   ```bash
   docker-compose restart nginx
   ```

---

## 📊 监控和维护

### 查看日志

```bash
# 查看所有服务日志
docker-compose logs -f

# 查看特定服务日志
docker-compose logs -f app
docker-compose logs -f mysql
docker-compose logs -f nginx

# 查看最近 100 行日志
docker-compose logs --tail=100 app
```

### 服务管理

```bash
# 启动服务
docker-compose up -d

# 停止服务
docker-compose down

# 重启服务
docker-compose restart

# 重启特定服务
docker-compose restart app

# 查看服务状态
docker-compose ps

# 查看资源使用
docker stats
```

### 数据库管理

```bash
# 进入 MySQL 容器
docker exec -it kylink-mysql mysql -u root -p

# 备份数据库
docker exec kylink-mysql mysqldump -u root -p${MYSQL_ROOT_PASSWORD} kyads_suffixpool > backup_$(date +%Y%m%d).sql

# 恢复数据库
docker exec -i kylink-mysql mysql -u root -p${MYSQL_ROOT_PASSWORD} kyads_suffixpool < backup.sql
```

### 更新应用

```bash
# 1. 拉取最新代码
git pull origin main

# 2. 重新构建
docker-compose build

# 3. 重启服务
docker-compose up -d

# 4. 查看日志
docker-compose logs -f app
```

### 清理资源

```bash
# 清理未使用的镜像
docker image prune -a

# 清理未使用的容器
docker container prune

# 清理未使用的卷
docker volume prune

# 清理所有未使用的资源
docker system prune -a
```

---

## 🐛 故障排查

### 问题 1：服务无法启动

**症状：** `docker-compose up -d` 失败

**解决方案：**

```bash
# 查看详细日志
docker-compose logs

# 检查端口占用
netstat -tulpn | grep 51001
netstat -tulpn | grep 3306

# 检查配置文件
docker-compose config
```

### 问题 2：数据库连接失败

**症状：** 应用日志显示 "Cannot connect to database"

**解决方案：**

```bash
# 检查 MySQL 状态
docker-compose ps mysql

# 查看 MySQL 日志
docker-compose logs mysql

# 测试数据库连接
docker exec kylink-mysql mysql -u root -p${MYSQL_ROOT_PASSWORD} -e "SELECT 1"

# 检查环境变量
docker exec kylink-app env | grep DATABASE_URL
```

### 问题 3：Nginx 502 错误

**症状：** 访问网站显示 502 Bad Gateway

**解决方案：**

```bash
# 检查应用状态
docker-compose ps app

# 查看应用日志
docker-compose logs app

# 测试应用端口
curl http://localhost:51001/api/health

# 检查 Nginx 配置
docker exec kylink-nginx nginx -t

# 重启 Nginx
docker-compose restart nginx
```

### 问题 4：内存不足

**症状：** 服务频繁重启或 OOM

**解决方案：**

```bash
# 查看内存使用
free -h
docker stats

# 限制容器内存
# 编辑 docker-compose.yml，添加：
# services:
#   app:
#     mem_limit: 2g

# 重启服务
docker-compose up -d
```

### 问题 5：磁盘空间不足

**症状：** 无法写入文件或创建容器

**解决方案：**

```bash
# 查看磁盘使用
df -h

# 清理 Docker 资源
docker system prune -a --volumes

# 清理日志
truncate -s 0 /var/lib/docker/containers/*/*-json.log
```

### 问题 6：Prisma 引擎与系统不兼容（登录/接口报错）

**症状：** 访问登录页或调用接口时报错：

- `Unable to require(...libquery_engine-linux-musl.so.node)`
- `Error loading shared library libssl.so.1.1: No such file or directory`

**原因：** 生产镜像基于 Alpine（Node 20-alpine），Alpine 3.17+ 默认使用 OpenSSL 3，而 Prisma 查询引擎可能依赖 OpenSSL 1.1。

**解决方案：**

1. 确保使用**当前项目**的 Dockerfile（已包含 `openssl1.1-compat`）重新构建并部署：
   ```bash
   # 拉取最新代码（含修复后的 Dockerfile）
   git pull origin main

   docker-compose build --no-cache app
   docker-compose up -d app
   ```
2. 若自行修改过 Dockerfile，在 runner 阶段加入：
   ```dockerfile
   RUN apk add --no-cache openssl1.1-compat
   ```
3. 参考 [Prisma 系统要求](https://pris.ly/d/system-requirements)。

---

## 📞 获取帮助

如果遇到问题：

1. 查看日志：`docker-compose logs -f`
2. 检查 [GitHub Issues](https://github.com/daphnelxqyp/kylink/issues)
3. 查看 [部署文档](./.github/DEPLOYMENT.md)
4. 联系技术支持

---

## 📚 相关文档

- [Docker 文档](https://docs.docker.com/)
- [Docker Compose 文档](https://docs.docker.com/compose/)
- [Nginx 文档](https://nginx.org/en/docs/)
- [Let's Encrypt 文档](https://letsencrypt.org/docs/)
- [阿里云 ECS 文档](https://help.aliyun.com/product/25365.html)

---

**最后更新：** 2026-01-31
