# 阿里云服务器部署指南

本指南详细说明如何将 KyLink 项目部署到阿里云服务器。

## 📋 目录

- [服务器要求](#服务器要求)
- [部署前准备](#部署前准备)
- [无 Docker 小白版（推荐）](#无-docker-小白版推荐)
- [（可选）Docker 部署](#可选docker-部署)
- [SSL 证书配置（无 Docker / Nginx）](#ssl-证书配置无-docker--nginx)
- [监控和维护（无 Docker / systemd）](#监控和维护无-docker--systemd)
- [故障排查](#故障排查)

---

## 🖥️ 服务器要求

### 最低配置

- **CPU**: 2 核
- **内存**: 4GB
- **硬盘**: 40GB SSD
- **带宽**: 3Mbps
- **操作系统**: Ubuntu 20.04 LTS / CentOS 7+ / Debian 13+

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
   - 开放端口：51001 (应用端口，**不建议对公网开放**；建议仅本机监听，由 Nginx 反代)
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

## ✅ 无 Docker 小白版（推荐）

> 适用于：刚买的服务器（Debian 13+ / Ubuntu 22.04+），**不使用 Docker**，域名已解析到服务器（例如你的 `https://xc.kyads.net/`）。
>
> 本流程目标：仅对公网开放 **80/443**，应用仅本机监听 `127.0.0.1:51001`，由 Nginx 反向代理；使用 `systemd` 守护进程，重启不掉线。

### 0. 你需要准备的信息（先写下来）

- **域名**：`xc.kyads.net`
- **数据库名**：`kyads_suffixpool`
- **数据库用户/密码**：例如 `kylink` / `强密码`
- **两段密钥**：`NEXTAUTH_SECRET`、`CRON_SECRET`（下面会教你生成）

### 1. SSH 连接服务器

```bash
ssh root@your-server-ip
```

### 2. 更新系统 + 安装基础工具

```bash
apt update && apt -y upgrade
apt -y install git curl ca-certificates gnupg lsb-release build-essential
```

### 3. 安装 Node.js 20（推荐）

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt -y install nodejs
node -v
npm -v
```

### 4. 安装并启动数据库（Debian 13 默认是 MariaDB）

```bash
# Debian 13 官方源默认提供 MariaDB（可替代 MySQL 使用）
apt -y install mariadb-server
systemctl enable mariadb
systemctl start mariadb
```

创建数据库和用户（把密码换成你自己的强密码）：

```bash
mariadb -u root <<'SQL'
CREATE DATABASE kyads_suffixpool DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'kylink'@'localhost' IDENTIFIED BY 'CHANGE_ME_STRONG_PASSWORD';
GRANT ALL PRIVILEGES ON kyads_suffixpool.* TO 'kylink'@'localhost';
FLUSH PRIVILEGES;
SQL
```

### 5. 创建运行用户（推荐）并拉取代码到 `/opt/kylink`

```bash
useradd -m -s /bin/bash kylink || true
mkdir -p /opt/kylink
chown -R kylink:kylink /opt/kylink
```

```bash
sudo -u kylink bash -lc '
cd /opt
git clone https://github.com/daphnelxqyp/kylink.git kylink
cd /opt/kylink
'
```

### 6. 配置环境变量（重要：不要直接照搬仓库里的 `.env.production`）

> 说明：仓库内的 `.env.production` 主要偏 Docker 场景（例如 `DATABASE_URL` 的 host 可能是 `mysql` 容器名），无 Docker 必须改为 `127.0.0.1`。
>
> ✅ 建议把生产密钥放在 `/etc/kylink/kylink.env`，并限制权限（下面第 8 步会做）。

先生成安全密钥（复制输出值备用）：

```bash
openssl rand -base64 32   # NEXTAUTH_SECRET
openssl rand -hex 32      # CRON_SECRET
```

### 7. 安装依赖 + 初始化数据库 + 构建

```bash
sudo -u kylink bash -lc '
cd /opt/kylink
npm ci
npm run db:push
npm run build
'
```

### 8. 用 systemd 守护服务（无 Docker）

创建环境变量文件（把 `CHANGE_ME_*` 全部替换成你的真实值；域名用你的 `xc.kyads.net`）：

```bash
mkdir -p /etc/kylink
cat >/etc/kylink/kylink.env <<'ENV'
NODE_ENV=production
PORT=51001

# 数据库（无 Docker：127.0.0.1）
DATABASE_URL="mysql://kylink:CHANGE_ME_STRONG_PASSWORD@127.0.0.1:3306/kyads_suffixpool"

# NextAuth
NEXTAUTH_URL="https://xc.kyads.net"
NEXTAUTH_SECRET="CHANGE_ME_NEXTAUTH_SECRET"

# 前端请求后端 API 的基地址
NEXT_PUBLIC_API_BASE_URL="https://xc.kyads.net"

# 定时任务密钥
CRON_SECRET="CHANGE_ME_CRON_SECRET"

# 生产环境务必关闭 mock
ALLOW_MOCK_SUFFIX=false

# 其余可选项（按需填写）
PROXY_API_URL=""
PROXY_API_KEY=""
MAX_BATCH_SIZE=500
STOCK_CONCURRENCY=5
CAMPAIGN_CONCURRENCY=3
ENV

# 让 systemd 与 kylink 用户都能读取（但其他用户不可读）
chown root:kylink /etc/kylink/kylink.env
chmod 640 /etc/kylink/kylink.env
```

创建 `systemd` 服务：

```bash
cat >/etc/systemd/system/kylink.service <<'SERVICE'
[Unit]
Description=KyLink (Next.js)
After=network.target mysql.service

[Service]
Type=simple
User=kylink
WorkingDirectory=/opt/kylink
EnvironmentFile=/etc/kylink/kylink.env
ExecStart=/usr/bin/npm run start
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
SERVICE
```

启动并验证：

```bash
systemctl daemon-reload
systemctl enable kylink
systemctl start kylink
systemctl status kylink --no-pager
```

```bash
curl -fsS http://127.0.0.1:51001/api/health
```

如果 `systemctl status kylink` 显示不断重启（`activating (auto-restart)`），先看日志定位原因：

```bash
journalctl -u kylink -n 200 --no-pager
```

最常见报错之一是“找不到生产构建”，说明你忘了执行 `npm run build`（`.next` 目录不存在）。修复方式：

```bash
sudo -u kylink bash -lc 'cd /opt/kylink && npm run build'
systemctl restart kylink
```

### 9. 安装 Nginx 并做反向代理（先 HTTP）

```bash
apt -y install nginx
systemctl enable nginx
systemctl start nginx
```

创建站点配置（域名改成你的 `xc.kyads.net`）：

```bash
cat >/etc/nginx/sites-available/kylink <<'NGINX'
server {
    listen 80;
    server_name xc.kyads.net;

    client_max_body_size 20m;

    location / {
        proxy_pass http://127.0.0.1:51001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
NGINX
```

启用并检查配置：

```bash
ln -sf /etc/nginx/sites-available/kylink /etc/nginx/sites-enabled/kylink
nginx -t
systemctl reload nginx
```

验证域名 HTTP 是否通：

```bash
curl -I http://xc.kyads.net
curl -fsS http://xc.kyads.net/api/health
```

### 10. 配置 HTTPS（Let's Encrypt）

> 下面会自动修改 Nginx 配置并配置续期。

```bash
apt -y install certbot python3-certbot-nginx
certbot --nginx -d xc.kyads.net
```

验证 HTTPS：

```bash
curl -fsS https://xc.kyads.net/api/health
```

检查自动续期（建议执行一次 dry-run）：

```bash
certbot renew --dry-run
```

### 11. 创建管理员账号（可选，但通常需要）

> 注意：`create-admin.ts` 需要读到 `DATABASE_URL` 等环境变量。
> 如果你使用 `sudo -u kylink` 手动执行，请先加载 `/etc/kylink/kylink.env`。
>
> 另外，如果项目未安装 `ts-node`，`npx` 可能会询问 “Ok to proceed?”。
> 用 `npx --yes ts-node@...` 可以避免交互提示。

```bash
sudo -u kylink bash -lc '
cd /opt/kylink
set -a
source /etc/kylink/kylink.env
set +a
npx --yes ts-node@10.9.2 --compiler-options "{\"module\":\"commonjs\"}" scripts/create-admin.ts
'
```

### 12. 日常更新（无 Docker）

```bash
sudo -u kylink bash -lc '
cd /opt/kylink
git pull origin main
npm ci
npm run db:push
npm run build
'
systemctl restart kylink
systemctl status kylink --no-pager
```

查看日志：

```bash
journalctl -u kylink -f
```

---

## （可选）Docker 部署

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

## 🔒 SSL 证书配置（无 Docker / Nginx）

### 方式一：使用 Let's Encrypt（免费，推荐）

```bash
# 1. 安装 Certbot（Nginx 插件）
apt update
apt -y install certbot python3-certbot-nginx

# 2. 申请证书并自动改写 Nginx 配置
# 把域名替换成你的域名，例如：xc.kyads.net
certbot --nginx -d your-domain.com

# 3. 验证自动续期
certbot renew --dry-run
```

### 方式二：使用阿里云 SSL 证书

1. 在阿里云控制台申请免费 SSL 证书
2. 下载 Nginx 格式证书
3. 上传到服务器：
   ```bash
   scp fullchain.pem root@your-server-ip:/etc/nginx/ssl/your-domain.com/
   scp privkey.pem root@your-server-ip:/etc/nginx/ssl/your-domain.com/
   ```
4. 配置 Nginx 使用证书（示例片段）：
   ```nginx
   server {
       listen 443 ssl http2;
       server_name your-domain.com;

       ssl_certificate     /etc/nginx/ssl/your-domain.com/fullchain.pem;
       ssl_certificate_key /etc/nginx/ssl/your-domain.com/privkey.pem;

       location / {
           proxy_pass http://127.0.0.1:51001;
           proxy_set_header Host $host;
           proxy_set_header X-Forwarded-Proto $scheme;
           proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
       }
   }
   ```
5. 重启 Nginx：
   ```bash
   nginx -t
   systemctl reload nginx
   ```

---

## 📊 监控和维护（无 Docker / systemd）

### 查看日志

```bash
# 查看服务实时日志
journalctl -u kylink -f

# 查看最近 200 行
journalctl -u kylink -n 200 --no-pager
```

### 服务管理

```bash
# 启动服务
systemctl start kylink

# 停止服务
systemctl stop kylink

# 重启服务
systemctl restart kylink

# 查看服务状态
systemctl status kylink --no-pager

# Nginx / MySQL
systemctl status nginx --no-pager
systemctl status mysql --no-pager
```

### 数据库管理

```bash
# 登录 MySQL
mysql -u root -p

# 备份数据库
mysqldump -u root -p kyads_suffixpool > backup_$(date +%Y%m%d).sql

# 恢复数据库
mysql -u root -p kyads_suffixpool < backup.sql
```

### 更新应用

```bash
# 1. 拉取最新代码
sudo -u kylink bash -lc 'cd /opt/kylink && git pull origin main'

# 2. 安装依赖 + 数据库同步 + 构建
sudo -u kylink bash -lc 'cd /opt/kylink && npm ci && npm run db:push && npm run build'

# 3. 重启服务
systemctl restart kylink

# 4. 查看日志
journalctl -u kylink -f
```

### 清理资源

```bash
# 清理 systemd 日志（按需）
journalctl --vacuum-time=14d

# 清理 npm 缓存（按需）
sudo -u kylink npm cache verify
```

---

## 🐛 故障排查

### 问题 1：服务无法启动

**症状：** `systemctl start kylink` 失败 / 服务反复重启

**解决方案：**

```bash
# 查看详细日志
journalctl -u kylink -n 200 --no-pager
journalctl -u kylink -f

# 检查端口占用
ss -lntp | grep 51001 || true
ss -lntp | grep 3306 || true

# 检查服务配置
systemctl cat kylink
ls -l /etc/kylink/kylink.env
```

### 问题 2：数据库连接失败

**症状：** 应用日志显示 "Cannot connect to database"

**解决方案：**

```bash
# 检查 MySQL 状态
systemctl status mysql --no-pager

# 测试数据库连接
mysql -u root -p -e "SELECT 1"

# 检查环境变量文件（注意别把密码发给别人）
grep -n "DATABASE_URL" /etc/kylink/kylink.env
```

### 问题 3：Nginx 502 错误

**症状：** 访问网站显示 502 Bad Gateway

**解决方案：**

```bash
# 检查应用状态
systemctl status kylink --no-pager

# 查看应用日志
journalctl -u kylink -n 200 --no-pager

# 测试应用端口
curl http://localhost:51001/api/health

# 检查 Nginx 配置
nginx -t

# 重启 Nginx
systemctl reload nginx
```

### 问题 3.1：应用端口被占用（EADDRINUSE: 51001）

**症状：** `journalctl -u kylink` 里出现：

- `Error: listen EADDRINUSE: address already in use :::51001`

**原因：** 51001 已被其它进程监听（常见：你手动执行过 `npm run dev` / `npm run start`，或旧进程未退出）。

**解决方案：**

先停止 `kylink`，避免 systemd 无限重启刷日志：

```bash
systemctl stop kylink
systemctl reset-failed kylink
```

找出占用 51001 的进程：

```bash
ss -lntp | grep ":51001" || true
```

如果你的系统没有 `ss` 输出进程名，可安装 `lsof`：

```bash
apt -y install lsof
lsof -nP -iTCP:51001 -sTCP:LISTEN
```

杀掉占用端口的进程（把 PID 替换成你的实际值）：

```bash
kill PID
sleep 1
kill -9 PID || true
```

确认端口空闲后再启动：

```bash
ss -lntp | grep ":51001" || echo "51001 OK"
systemctl start kylink
systemctl status kylink --no-pager
curl -fsS http://127.0.0.1:51001/api/health
```

### 问题 4：内存不足

**症状：** 服务频繁重启或 OOM

**解决方案：**

```bash
# 查看内存使用
free -h

# 查看进程资源占用
ps aux --sort=-%mem | head -n 15

# 可选：增加 swap（示例：2G）
fallocate -l 2G /swapfile
chmod 600 /swapfile
mkswap /swapfile
swapon /swapfile
swapon --show
```

### 问题 5：磁盘空间不足

**症状：** 无法写入文件或创建容器

**解决方案：**

```bash
# 查看磁盘使用
df -h

# 清理系统日志
journalctl --vacuum-time=14d

# 查看大文件/目录（按需）
du -h /var/log | sort -h | tail -n 20
```

### 问题 6：Prisma 引擎与系统不兼容（登录/接口报错）

**症状：** 访问登录页或调用接口时报错：

- `Unable to require(...libquery_engine-linux-musl.so.node)`
- `Error loading shared library libssl.so.1.1: No such file or directory`

**原因：** 
- Alpine 3.19+ 已移除 `openssl1.1-compat` 包
- Prisma schema 已配置 `binaryTargets = ["native", "linux-musl-openssl-3.0.x"]`，应使用 OpenSSL 3.0 的查询引擎

**解决方案：**

1. 确保使用**当前项目**的 Dockerfile 和 Prisma schema（已配置 OpenSSL 3.0 支持）重新构建并部署：
   ```bash
   # 拉取最新代码
   git pull origin main

   docker-compose build --no-cache app
   docker-compose up -d app
   ```
2. 若仍遇到 OpenSSL 错误，检查 Prisma schema 中的 `binaryTargets` 是否包含 `linux-musl-openssl-3.0.x`：
   ```prisma
   generator client {
     provider      = "prisma-client-js"
     binaryTargets = ["native", "linux-musl-openssl-3.0.x"]
   }
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

**最后更新：** 2026-02-03
