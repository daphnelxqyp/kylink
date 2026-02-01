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

# 构建应用：禁用遥测避免非交互式构建卡住，限制内存降低 OOM 导致假死
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_OPTIONS="--max-old-space-size=2048"
RUN npm run build

# 生产阶段
FROM node:20-alpine AS runner

# 设置工作目录
WORKDIR /app

# 设置环境变量
ENV NODE_ENV=production
ENV PORT=51001

# Prisma 查询引擎依赖 libssl.so.1.1（Alpine 3.17+ 默认仅 OpenSSL 3），需安装兼容层
# 参见 https://pris.ly/d/system-requirements
RUN apk add --no-cache openssl1.1-compat

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
