# 多阶段构建 - 构建阶段
FROM node:20-alpine AS builder

# 设置工作目录
WORKDIR /app

# 复制 package 文件
COPY package*.json ./
COPY prisma ./prisma/

# 安装依赖
RUN npm ci

# 复制源代码
COPY . .

# 确保 public 目录存在（Next.js 可选，无则 COPY 会失败）
RUN mkdir -p /app/public

# 生成 Prisma Client
RUN npx prisma generate

# 构建应用：针对小内存服务器（<= 2GB）的极限优化
ENV NEXT_TELEMETRY_DISABLED=1
# 限制内存为 1GB，强制单线程编译
ENV NODE_OPTIONS="--max-old-space-size=1024"
# 禁用所有缓存和并行处理
ENV NEXT_WEBPACK_CACHE=false
# 单线程编译（关键！大幅减少内存）
ENV UV_THREADPOOL_SIZE=1
RUN npm run build

# 生产阶段
FROM node:20-alpine AS runner

# 设置工作目录
WORKDIR /app

# 设置环境变量
ENV NODE_ENV=production
ENV PORT=51001

# 注意：Prisma schema 已配置 binaryTargets = ["native", "linux-musl-openssl-3.0.x"]
# Alpine 3.19+ 不再提供 openssl1.1-compat，Prisma 5.x 已原生支持 OpenSSL 3.0
# 无需安装兼容包，Prisma 会自动使用 OpenSSL 3.0 的查询引擎

# 创建非 root 用户
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# 复制必要文件
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma

# 设置文件权限
RUN chown -R nextjs:nodejs /app

# 切换到非 root 用户
USER nextjs

# 暴露端口
EXPOSE 51001

# 启动应用
CMD ["node", "server.js"]
