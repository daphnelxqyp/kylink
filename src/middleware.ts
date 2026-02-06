/**
 * Next.js 中间件
 *
 * 实现以下安全功能：
 * 1. Rate Limiting - 请求频率限制
 * 2. Security Headers - 安全响应头
 * 3. Authentication - 登录认证保护
 */

import { NextRequest, NextResponse } from 'next/server'
import { getToken } from 'next-auth/jwt'
import { isAdminOnlyRoute, isAdminOnlyApiRoute } from '@/lib/role-config'

// ============================================
// Rate Limiting 配置
// ============================================

interface RateLimitConfig {
  windowMs: number      // 时间窗口（毫秒）
  maxRequests: number   // 最大请求数
}

// 不同路径的限流配置
const RATE_LIMIT_CONFIGS: Record<string, RateLimitConfig> = {
  // API 默认限流：每分钟 100 次
  '/api/': { windowMs: 60 * 1000, maxRequests: 100 },
  // 认证相关接口：每分钟 20 次（防止暴力破解）
  '/api/v1/admin/users': { windowMs: 60 * 1000, maxRequests: 20 },
  // 批量操作：每分钟 30 次
  '/api/v1/suffix/lease/batch': { windowMs: 60 * 1000, maxRequests: 30 },
  '/api/v1/suffix/report/batch': { windowMs: 60 * 1000, maxRequests: 30 },
}

// 内存存储（生产环境建议使用 Redis）
interface RateLimitEntry {
  count: number
  resetTime: number
}

const rateLimitStore = new Map<string, RateLimitEntry>()

// 定期清理过期的限流记录（每5分钟）
const CLEANUP_INTERVAL = 5 * 60 * 1000
let lastCleanup = Date.now()

function cleanupExpiredEntries() {
  const now = Date.now()
  if (now - lastCleanup < CLEANUP_INTERVAL) return

  lastCleanup = now
  for (const [key, entry] of rateLimitStore.entries()) {
    if (entry.resetTime < now) {
      rateLimitStore.delete(key)
    }
  }
}

/**
 * 获取客户端标识符
 * 优先使用 API Key，其次使用 IP
 */
function getClientIdentifier(request: NextRequest): string {
  // 优先从 Authorization 头提取 API Key 前缀
  const authHeader = request.headers.get('Authorization')
  if (authHeader?.startsWith('Bearer ky_')) {
    // 使用 API Key 的前16位作为标识（不暴露完整 Key）
    return `apikey:${authHeader.substring(7, 23)}`
  }

  // 使用 IP 地址
  const forwarded = request.headers.get('x-forwarded-for')
  const ip = forwarded?.split(',')[0]?.trim() ||
             request.headers.get('x-real-ip') ||
             request.ip ||
             'unknown'
  return `ip:${ip}`
}

/**
 * 获取路径对应的限流配置
 */
function getRateLimitConfig(pathname: string): RateLimitConfig {
  // 按路径前缀匹配，优先匹配更具体的路径
  const sortedPaths = Object.keys(RATE_LIMIT_CONFIGS).sort((a, b) => b.length - a.length)

  for (const path of sortedPaths) {
    if (pathname.startsWith(path)) {
      return RATE_LIMIT_CONFIGS[path]
    }
  }

  // 默认配置
  return { windowMs: 60 * 1000, maxRequests: 100 }
}

/**
 * 检查请求是否超过限流
 */
function checkRateLimit(
  identifier: string,
  pathname: string
): { allowed: boolean; remaining: number; resetTime: number } {
  const config = getRateLimitConfig(pathname)
  const key = `${identifier}:${pathname}`
  const now = Date.now()

  let entry = rateLimitStore.get(key)

  // 如果没有记录或已过期，创建新记录
  if (!entry || entry.resetTime < now) {
    entry = {
      count: 1,
      resetTime: now + config.windowMs,
    }
    rateLimitStore.set(key, entry)
    return {
      allowed: true,
      remaining: config.maxRequests - 1,
      resetTime: entry.resetTime,
    }
  }

  // 增加计数
  entry.count++

  // 检查是否超限
  if (entry.count > config.maxRequests) {
    return {
      allowed: false,
      remaining: 0,
      resetTime: entry.resetTime,
    }
  }

  return {
    allowed: true,
    remaining: config.maxRequests - entry.count,
    resetTime: entry.resetTime,
  }
}

// ============================================
// 安全响应头
// ============================================

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'X-XSS-Protection': '1; mode=block',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
}

// ============================================
// 中间件主函数
// ============================================

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // ============================================
  // 1. 登录认证保护（页面路由）
  // ============================================

  // 公开路由（无需登录）
  const publicPaths = ['/login', '/api/auth']
  const isPublicPath = publicPaths.some(path => pathname.startsWith(path))

  // API 路由使用 API Key 认证，不需要 session 认证（除了 /api/auth）
  const isApiRoute = pathname.startsWith('/api/') && !pathname.startsWith('/api/auth')

  // 静态资源跳过认证
  const isStaticAsset = pathname.startsWith('/_next') || pathname === '/favicon.ico'

  if (!isPublicPath && !isApiRoute && !isStaticAsset) {
    // 页面路由需要登录
    const token = await getToken({ req: request })

    if (!token) {
      const loginUrl = new URL('/login', request.url)
      loginUrl.searchParams.set('callbackUrl', pathname)
      return NextResponse.redirect(loginUrl)
    }

    // 检查管理员专属路由的角色权限
    if (isAdminOnlyRoute(pathname) && token.role !== 'ADMIN') {
      const homeUrl = new URL('/', request.url)
      homeUrl.searchParams.set('error', 'unauthorized')
      return NextResponse.redirect(homeUrl)
    }
  }

  // ============================================
  // 2. Rate Limiting（API 路由）
  // ============================================
  if (pathname.startsWith('/api/')) {
    // 管理员专属 API 路由保护（需要 session 认证）
    if (isAdminOnlyApiRoute(pathname)) {
      const token = await getToken({ req: request })
      if (!token || token.role !== 'ADMIN') {
        return new NextResponse(
          JSON.stringify({
            success: false,
            error: {
              code: 'FORBIDDEN',
              message: '权限不足',
            },
          }),
          {
            status: 403,
            headers: {
              'Content-Type': 'application/json',
              ...SECURITY_HEADERS,
            },
          }
        )
      }
    }

    // 定期清理过期记录
    cleanupExpiredEntries()

    const identifier = getClientIdentifier(request)
    const { allowed, remaining, resetTime } = checkRateLimit(identifier, pathname)

    if (!allowed) {
      return new NextResponse(
        JSON.stringify({
          success: false,
          error: {
            code: 'RATE_LIMIT_EXCEEDED',
            message: '请求过于频繁，请稍后重试',
          },
        }),
        {
          status: 429,
          headers: {
            'Content-Type': 'application/json',
            'Retry-After': String(Math.ceil((resetTime - Date.now()) / 1000)),
            'X-RateLimit-Limit': String(getRateLimitConfig(pathname).maxRequests),
            'X-RateLimit-Remaining': '0',
            'X-RateLimit-Reset': String(Math.ceil(resetTime / 1000)),
            ...SECURITY_HEADERS,
          },
        }
      )
    }

    // 允许请求，添加限流头
    const response = NextResponse.next()

    response.headers.set('X-RateLimit-Limit', String(getRateLimitConfig(pathname).maxRequests))
    response.headers.set('X-RateLimit-Remaining', String(remaining))
    response.headers.set('X-RateLimit-Reset', String(Math.ceil(resetTime / 1000)))

    // 添加安全响应头
    for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
      response.headers.set(key, value)
    }

    return response
  }

  // 非 API 路由只添加安全响应头
  const response = NextResponse.next()
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
    response.headers.set(key, value)
  }

  return response
}

// 配置中间件匹配规则
export const config = {
  matcher: [
    // 匹配所有 API 路由
    '/api/:path*',
    // 匹配所有页面路由（添加安全头）
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
}
