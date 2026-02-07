/**
 * 重定向追踪器
 * 
 * 负责追踪联盟链接的完整重定向链路
 * 支持 HTTP 重定向、Meta Refresh、JavaScript 跳转
 */

// 使用 Next.js 内置的 node-fetch 和 https-proxy-agent
/* eslint-disable */
const fetch = require('next/dist/compiled/node-fetch')
const { HttpsProxyAgent } = require('next/dist/compiled/https-proxy-agent')
/* eslint-enable */
// SOCKS5 代理支持
import { SocksProxyAgent } from 'socks-proxy-agent'
import * as https from 'https'

import type {
  AffiliateVerifyRequest,
  AffiliateVerifyResponse,
  RedirectStep,
  RedirectType,
  ProxyRequestConfig,
} from '@/types/affiliate-verify'
import { extractRootDomain, normalizeDomain } from './domain-validator'

// ============================================
// 追踪器接口定义
// ============================================

/**
 * 重定向追踪器接口
 */
export interface IRedirectTracker {
  /**
   * 追踪联盟链接的重定向链路
   * @param request 验证请求参数
   * @returns 验证响应结果
   */
  trace(request: AffiliateVerifyRequest): Promise<AffiliateVerifyResponse>
}

/**
 * 单次请求的追踪结果（内部使用）
 */
export interface TraceResult {
  /** 是否成功获取响应 */
  success: boolean
  
  /** 响应状态码 */
  statusCode?: number
  
  /** 响应头 */
  headers?: Record<string, string>
  
  /** 响应体（用于解析 meta/js 重定向） */
  body?: string
  
  /** 下一跳 URL（如果有重定向） */
  nextUrl?: string
  
  /** 重定向类型 */
  redirectType?: RedirectType
  
  /** 错误信息 */
  error?: string
}

/**
 * 追踪器配置选项
 */
export interface TrackerOptions {
  /** 代理配置（为空则不使用代理） */
  proxy?: ProxyRequestConfig
  
  /** 请求超时时间（毫秒） */
  timeout?: number
  
  /** 自定义 User-Agent */
  userAgent?: string
  
  /** 自定义请求头 */
  headers?: Record<string, string>
}

/**
 * HTML 重定向提取结果
 */
export interface HtmlRedirectResult {
  /** 提取到的跳转 URL */
  url: string
  
  /** 重定向类型：meta refresh 或 JavaScript 跳转 */
  type: 'meta' | 'js'
}

// ============================================
// JavaScript 跳转正则模式（可扩展）
// ============================================

/**
 * JavaScript 跳转模式定义
 */
interface JsRedirectPattern {
  /** 模式名称（用于调试） */
  name: string
  
  /** 正则表达式 */
  regex: RegExp
  
  /** URL 在匹配结果中的组索引（从 1 开始） */
  urlGroup: number
}

/**
 * JavaScript 跳转正则模式数组
 * 按优先级排序，先匹配的优先
 * 
 * 支持的跳转方式：
 * - window.location.href = "url"
 * - window.location = "url"
 * - location.href = "url"
 * - location = "url"
 * - location.replace("url")
 * - location.assign("url")
 * - document.location = "url"
 * - document.location.href = "url"
 * - self.location = "url"
 * - top.location = "url"
 * - parent.location = "url"
 * - setTimeout 包裹的跳转
 * - setInterval 包裹的跳转
 */
const JS_REDIRECT_PATTERNS: JsRedirectPattern[] = [
  // === location.replace / location.assign ===
  {
    name: 'location.replace',
    // 匹配: (window.|document.|self.|top.|parent.)?location.replace("url") 或 ('url')
    regex: /(?:window\.|document\.|self\.|top\.|parent\.)?location\.replace\s*\(\s*["'`]([^"'`]+)["'`]\s*\)/gi,
    urlGroup: 1,
  },
  {
    name: 'location.assign',
    // 匹配: (window.|document.|self.|top.|parent.)?location.assign("url")
    regex: /(?:window\.|document\.|self\.|top\.|parent\.)?location\.assign\s*\(\s*["'`]([^"'`]+)["'`]\s*\)/gi,
    urlGroup: 1,
  },
  
  // === window.location.href = "url" ===
  {
    name: 'window.location.href',
    // 匹配: window.location.href = "url"
    regex: /window\.location\.href\s*=\s*["'`]([^"'`]+)["'`]/gi,
    urlGroup: 1,
  },
  
  // === document.location.href = "url" ===
  {
    name: 'document.location.href',
    regex: /document\.location\.href\s*=\s*["'`]([^"'`]+)["'`]/gi,
    urlGroup: 1,
  },
  
  // === self.location.href / top.location.href / parent.location.href ===
  {
    name: 'self.location.href',
    regex: /self\.location\.href\s*=\s*["'`]([^"'`]+)["'`]/gi,
    urlGroup: 1,
  },
  {
    name: 'top.location.href',
    regex: /top\.location\.href\s*=\s*["'`]([^"'`]+)["'`]/gi,
    urlGroup: 1,
  },
  {
    name: 'parent.location.href',
    regex: /parent\.location\.href\s*=\s*["'`]([^"'`]+)["'`]/gi,
    urlGroup: 1,
  },
  {
    name: 'parent.location (assignment)',
    regex: /parent\.location\s*=\s*["'`]([^"'`]+)["'`]/gi,
    urlGroup: 1,
  },
  
  // === location.href = "url" (不带前缀) ===
  {
    name: 'location.href',
    regex: /(?<![.\w])location\.href\s*=\s*["'`]([^"'`]+)["'`]/gi,
    urlGroup: 1,
  },
  
  // === window.location = "url" ===
  {
    name: 'window.location',
    // 匹配 window.location = "url"，排除 window.location.xxx
    regex: /window\.location\s*=\s*["'`]([^"'`]+)["'`]/gi,
    urlGroup: 1,
  },
  
  // === document.location = "url" ===
  {
    name: 'document.location',
    regex: /document\.location\s*=\s*["'`]([^"'`]+)["'`]/gi,
    urlGroup: 1,
  },
  
  // === self.location / top.location / parent.location ===
  {
    name: 'self.location',
    regex: /self\.location\s*=\s*["'`]([^"'`]+)["'`]/gi,
    urlGroup: 1,
  },
  {
    name: 'top.location',
    regex: /top\.location\s*=\s*["'`]([^"'`]+)["'`]/gi,
    urlGroup: 1,
  },
  {
    name: 'parent.location',
    regex: /parent\.location\s*=\s*["'`]([^"'`]+)["'`]/gi,
    urlGroup: 1,
  },
  
  // === location = "url" (不带任何前缀) ===
  {
    name: 'location',
    // 使用负向后行断言，排除 xxx.location
    regex: /(?<![.\w])location\s*=\s*["'`]([^"'`]+)["'`]/gi,
    urlGroup: 1,
  },
  
  // === setTimeout 包裹 ===
  {
    name: 'setTimeout location.href',
    // 匹配: setTimeout(function() { location.href = "url" }, xxx)
    // 或: setTimeout(() => { location.href = "url" }, xxx)
    regex: /setTimeout\s*\([^)]*(?:window\.|document\.)?location(?:\.href)?\s*=\s*["'`]([^"'`]+)["'`]/gi,
    urlGroup: 1,
  },
  {
    name: 'setTimeout location.replace',
    regex: /setTimeout\s*\([^)]*(?:window\.|document\.)?location\.(?:replace|assign)\s*\(\s*["'`]([^"'`]+)["'`]/gi,
    urlGroup: 1,
  },
  
  // === setInterval 包裹（少见但存在） ===
  {
    name: 'setInterval location',
    regex: /setInterval\s*\([^)]*(?:window\.|document\.)?location(?:\.href)?\s*=\s*["'`]([^"'`]+)["'`]/gi,
    urlGroup: 1,
  },
  
  // === window.open 作为重定向（当前窗口） ===
  {
    name: 'window.open _self',
    // window.open("url", "_self") - 在当前窗口打开
    regex: /window\.open\s*\(\s*["'`]([^"'`]+)["'`]\s*,\s*["'`]_self["'`]/gi,
    urlGroup: 1,
  },
  
  // === 变量形式（常见混淆） ===
  {
    name: 'var redirect (named)',
    // 匹配: var redirectUrl = "url" 后面紧跟 location 赋值（变量名含 url/redirect/link/href）
    regex: /(?:var|let|const)\s+\w*(?:url|redirect|link|href)\w*\s*=\s*["'`]([^"'`]+)["'`]\s*;?\s*(?:window\.|document\.)?location/gi,
    urlGroup: 1,
  },
  {
    name: 'var redirect (any var + http url)',
    // 匹配: var/let/const 任意变量 = "http(s)://url"; 后跟 location 使用
    // 支持 collabglow 等联盟平台的变量间接重定向：var u = "https://..."; location.replace(u);
    regex: /(?:var|let|const)\s+\w+\s*=\s*["'`](https?:\/\/[^"'`]+)["'`]\s*;?\s*(?:window\.|document\.|self\.|top\.|parent\.)?location/gi,
    urlGroup: 1,
  },
  
  // === eval 包裹（安全考虑，但需要支持） ===
  {
    name: 'eval location',
    regex: /eval\s*\(\s*["'`][^"'`]*location(?:\.href)?\s*=\s*\\?["'`]([^"'`\\]+)/gi,
    urlGroup: 1,
  },
]

/**
 * Meta Refresh 正则模式
 * 支持多种格式：
 * - <meta http-equiv="refresh" content="0;url=xxx">
 * - <meta http-equiv="refresh" content="0; url=xxx">
 * - <meta http-equiv="refresh" content="5;URL='xxx'">
 * - <meta http-equiv='refresh' content='0;url=xxx'>
 */
const META_REFRESH_PATTERNS: RegExp[] = [
  // 标准格式：http-equiv="refresh" content="N;url=xxx"
  /<meta[^>]*http-equiv\s*=\s*["']?refresh["']?[^>]*content\s*=\s*["']?\d+\s*;\s*url\s*=\s*["']?([^"'\s>]+)["']?[^>]*>/gi,
  
  // content 在前：content="N;url=xxx" http-equiv="refresh"
  /<meta[^>]*content\s*=\s*["']?\d+\s*;\s*url\s*=\s*["']?([^"'\s>]+)["']?[^>]*http-equiv\s*=\s*["']?refresh["']?[^>]*>/gi,
  
  // 无 url= 前缀的简化格式（少见）：content="0; https://xxx"
  /<meta[^>]*http-equiv\s*=\s*["']?refresh["']?[^>]*content\s*=\s*["']?\d+\s*;\s*["']?(https?:\/\/[^"'\s>]+)["']?[^>]*>/gi,
]

// ============================================
// HTML 重定向提取函数
// ============================================

/**
 * 从 HTML 内容中提取重定向 URL
 * 支持 Meta Refresh 和 JavaScript 跳转
 * 
 * @param html HTML 内容
 * @param baseUrl 基准 URL，用于解析相对路径
 * @returns 提取结果，包含 url 和 type；无重定向则返回 null
 * 
 * @example
 * // Meta Refresh
 * extractHtmlRedirectUrl('<meta http-equiv="refresh" content="0;url=/landing">', 'https://example.com')
 * // { url: 'https://example.com/landing', type: 'meta' }
 * 
 * // JavaScript 跳转
 * extractHtmlRedirectUrl('<script>window.location.href = "/page";</script>', 'https://example.com')
 * // { url: 'https://example.com/page', type: 'js' }
 */
export function extractHtmlRedirectUrl(html: string, baseUrl: string): HtmlRedirectResult | null {
  if (!html || typeof html !== 'string') {
    return null
  }

  // 先尝试解析 Meta Refresh（优先级更高，更可靠）
  const metaResult = extractMetaRefreshUrl(html, baseUrl)
  if (metaResult) {
    return metaResult
  }

  // 再尝试解析 JavaScript 跳转
  const jsResult = extractJsRedirectUrl(html, baseUrl)
  if (jsResult) {
    return jsResult
  }

  return null
}

/**
 * 从 HTML 中提取 Meta Refresh URL
 */
function extractMetaRefreshUrl(html: string, baseUrl: string): HtmlRedirectResult | null {
  for (const pattern of META_REFRESH_PATTERNS) {
    // 重置正则状态
    pattern.lastIndex = 0
    
    const match = pattern.exec(html)
    if (match && match[1]) {
      const resolvedUrl = resolveAndValidateUrl(match[1], baseUrl)
      if (resolvedUrl) {
        return { url: resolvedUrl, type: 'meta' }
      }
    }
  }
  return null
}

/**
 * 从 HTML 中提取 JavaScript 跳转 URL
 */
function extractJsRedirectUrl(html: string, baseUrl: string): HtmlRedirectResult | null {
  // 遍历所有模式
  for (const pattern of JS_REDIRECT_PATTERNS) {
    // 重置正则状态
    pattern.regex.lastIndex = 0
    
    const match = pattern.regex.exec(html)
    if (match && match[pattern.urlGroup]) {
      const rawUrl = match[pattern.urlGroup]
      const resolvedUrl = resolveAndValidateUrl(rawUrl, baseUrl)
      if (resolvedUrl) {
        return { url: resolvedUrl, type: 'js' }
      }
    }
  }
  return null
}

/**
 * 解析并验证 URL
 * - 支持相对路径
 * - 支持缺协议 URL（//example.com）
 * - 过滤非 http(s) 协议
 * - 过滤与 baseUrl 相同的 URL（避免死循环）
 * 
 * @param rawUrl 原始 URL（可能是相对路径）
 * @param baseUrl 基准 URL
 * @returns 有效的绝对 URL，或 null
 */
function resolveAndValidateUrl(rawUrl: string, baseUrl: string): string | null {
  if (!rawUrl || typeof rawUrl !== 'string') {
    return null
  }

  // 去除首尾空格和可能的引号
  let url = rawUrl.trim().replace(/^["'`]|["'`]$/g, '')

  // 过滤非 http(s) 协议
  const lowerUrl = url.toLowerCase()
  if (
    lowerUrl.startsWith('javascript:') ||
    lowerUrl.startsWith('mailto:') ||
    lowerUrl.startsWith('tel:') ||
    lowerUrl.startsWith('data:') ||
    lowerUrl.startsWith('blob:') ||
    lowerUrl.startsWith('about:') ||
    lowerUrl.startsWith('file:') ||
    lowerUrl.startsWith('vbscript:') ||
    lowerUrl.startsWith('#') // 锚点
  ) {
    return null
  }

  // 解析 URL
  let resolvedUrl: string
  try {
    // 处理协议相对 URL（//example.com/path）
    if (url.startsWith('//')) {
      const baseProtocol = new URL(baseUrl).protocol
      url = baseProtocol + url
    }

    // 使用 URL 构造函数解析（自动处理相对路径）
    const urlObj = new URL(url, baseUrl)
    
    // 验证协议必须是 http 或 https
    if (urlObj.protocol !== 'http:' && urlObj.protocol !== 'https:') {
      return null
    }

    resolvedUrl = urlObj.href
  } catch {
    // URL 解析失败
    return null
  }

  // 检查是否与 baseUrl 相同（避免死循环）
  if (isSameUrl(resolvedUrl, baseUrl)) {
    return null
  }

  return resolvedUrl
}

/**
 * 判断两个 URL 是否相同（忽略末尾斜杠和片段标识符）
 */
function isSameUrl(url1: string, url2: string): boolean {
  try {
    const u1 = new URL(url1)
    const u2 = new URL(url2)

    // 移除片段标识符
    u1.hash = ''
    u2.hash = ''

    // 标准化路径（移除末尾斜杠）
    const path1 = u1.pathname.replace(/\/+$/, '') || '/'
    const path2 = u2.pathname.replace(/\/+$/, '') || '/'

    return (
      u1.protocol === u2.protocol &&
      u1.hostname.toLowerCase() === u2.hostname.toLowerCase() &&
      u1.port === u2.port &&
      path1 === path2 &&
      u1.search === u2.search
    )
  } catch {
    return url1 === url2
  }
}

// ============================================
// singleRequest 函数类型定义
// ============================================

/**
 * 代理配置（用于 singleRequest）
 */
export interface SingleRequestProxy {
  /** 代理 URL（如 http://proxy.example.com:8080 或 socks5://proxy.example.com:1080） */
  url: string
  
  /** 代理认证用户名 */
  username?: string
  
  /** 代理认证密码 */
  password?: string
  
  /** 代理协议类型（默认根据端口自动判断，或明确指定） */
  protocol?: 'http' | 'https' | 'socks5'
}

/**
 * singleRequest 配置选项
 */
export interface SingleRequestOptions {
  /** 代理配置 */
  proxy?: SingleRequestProxy
  
  /** 请求超时时间（毫秒，默认 10000） */
  timeout?: number
  
  /** 自定义 User-Agent */
  userAgent?: string
  
  /** Referer 头 */
  referer?: string
  
  /** 额外的请求头 */
  headers?: Record<string, string>
}

/**
 * singleRequest 返回结果
 */
export interface SingleRequestResult {
  /** HTTP 状态码 */
  statusCode: number
  
  /** 重定向目标 URL（3xx 或 meta/js 跳转时） */
  redirectUrl: string | null
  
  /** 最终请求的 URL */
  finalUrl: string
  
  /** 重定向类型 */
  redirectType?: 'http' | 'meta' | 'js'
  
  /** Content-Type 响应头 */
  contentType?: string
  
  /** 响应体片段（错误时或 HTML 时） */
  bodySnippet?: string
  
  /** 错误信息 */
  error?: string
}

// ============================================
// 默认浏览器请求头
// ============================================

/**
 * 默认 User-Agent（模拟 Chrome 浏览器）
 */
const DEFAULT_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

/**
 * 构建模拟浏览器的请求头
 */
function buildBrowserHeaders(options: SingleRequestOptions): Record<string, string> {
  const headers: Record<string, string> = {
    'User-Agent': options.userAgent || DEFAULT_USER_AGENT,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
    'Accept-Language': 'en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7',
    'Accept-Encoding': 'gzip, deflate, br',
    'Cache-Control': 'no-cache',
    'Pragma': 'no-cache',
    // Sec-Fetch-* 系列头（现代浏览器特征）
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1',
    'Sec-Ch-Ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
    'Sec-Ch-Ua-Mobile': '?0',
    'Sec-Ch-Ua-Platform': '"Windows"',
    'Upgrade-Insecure-Requests': '1',
  }

  // 添加 Referer
  if (options.referer) {
    headers['Referer'] = options.referer
    // 如果有 referer，调整 Sec-Fetch-Site
    try {
      const refererUrl = new URL(options.referer)
      // 简化判断：有 referer 就设为 cross-site
      headers['Sec-Fetch-Site'] = 'cross-site'
      // 可选：更精细的判断
      // if (refererUrl.hostname === new URL(targetUrl).hostname) {
      //   headers['Sec-Fetch-Site'] = 'same-origin'
      // }
    } catch {
      // referer 无效，忽略
    }
  }

  // 合并自定义请求头
  if (options.headers) {
    Object.assign(headers, options.headers)
  }

  return headers
}

// ============================================
// singleRequest 核心函数
// ============================================

/**
 * 执行单次 HTTP 请求
 * 
 * - 使用 manual redirect 模式
 * - 支持代理（通过 https-proxy-agent）
 * - 模拟浏览器请求头
 * - 处理证书问题（rejectUnauthorized=false）
 * - 解析 HTTP 重定向、Meta Refresh、JavaScript 跳转
 * 
 * @param url 请求 URL
 * @param options 配置选项
 * @returns 请求结果
 * 
 * @example
 * const result = await singleRequest('https://affiliate.example.com/link', {
 *   proxy: { url: 'http://proxy.example.com:8080' },
 *   referer: 'https://t.co',
 *   timeout: 10000,
 * })
 */
export async function singleRequest(url: string, options: SingleRequestOptions = {}): Promise<SingleRequestResult> {
  const timeout = options.timeout ?? 10000

  try {
    // 构建请求头
    const headers = buildBrowserHeaders(options)

    // 构建 fetch agent（处理代理和证书）
    let agent: https.Agent | InstanceType<typeof HttpsProxyAgent> | SocksProxyAgent

    if (options.proxy) {
      // 使用代理
      let proxyUrl = options.proxy.url

      // 如果有认证信息，添加到 URL
      if (options.proxy.username && options.proxy.password) {
        const proxyUrlObj = new URL(proxyUrl)
        proxyUrlObj.username = options.proxy.username
        proxyUrlObj.password = options.proxy.password
        proxyUrl = proxyUrlObj.href
      }

      // 判断代理协议类型
      const isSocks5 = options.proxy.protocol === 'socks5' || 
                       proxyUrl.startsWith('socks5://') || 
                       proxyUrl.startsWith('socks://') ||
                       options.proxy.url.includes(':1080') || // 常见 SOCKS 端口
                       options.proxy.url.includes(':2333') || // ipidea 端口
                       options.proxy.url.includes(':4950')    // abcproxy 端口

      if (isSocks5) {
        // SOCKS5 代理
        // 确保 URL 使用 socks5:// 协议
        if (!proxyUrl.startsWith('socks')) {
          proxyUrl = proxyUrl.replace(/^https?:\/\//, 'socks5://')
        }
        agent = new SocksProxyAgent(proxyUrl, {
          timeout: timeout,
        })
        console.log(`[tracker] Using SOCKS5 proxy: ${options.proxy.url}`)
      } else {
        // HTTP/HTTPS 代理
        agent = new HttpsProxyAgent(proxyUrl, {
          rejectUnauthorized: false,
        })
        console.log(`[tracker] Using HTTP proxy: ${options.proxy.url}`)
      }
    } else {
      // 无代理，使用普通 Agent（同样禁用证书验证）
      agent = new https.Agent({
        rejectUnauthorized: false,
      })
    }

    // 执行请求
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), timeout)

    let response: Awaited<ReturnType<typeof fetch>>
    try {
      response = await fetch(url, {
        method: 'GET',
        headers,
        redirect: 'manual', // 手动处理重定向
        agent,
        signal: controller.signal,
      })
    } finally {
      clearTimeout(timeoutId)
    }

    const statusCode = response.status
    const contentType = response.headers.get('content-type') || undefined

    // ============================================
    // 处理 HTTP 重定向 (3xx)
    // ============================================
    if (isRedirectStatusCode(statusCode)) {
      const locationHeader = response.headers.get('location')
      
      if (!locationHeader) {
        return {
          statusCode,
          redirectUrl: null,
          finalUrl: url,
          redirectType: 'http',
          contentType,
          error: 'MISSING_LOCATION_HEADER',
        }
      }

      // 解析 Location 为绝对 URL
      const redirectUrl = resolveToAbsoluteHttpUrl(locationHeader, url)
      
      if (!redirectUrl) {
        return {
          statusCode,
          redirectUrl: null,
          finalUrl: url,
          redirectType: 'http',
          contentType,
          error: 'INVALID_REDIRECT_URL',
        }
      }

      return {
        statusCode,
        redirectUrl,
        finalUrl: url,
        redirectType: 'http',
        contentType,
      }
    }

    // ============================================
    // 处理错误响应 (4xx/5xx)
    // ============================================
    if (statusCode >= 400) {
      // 读取响应体并截断
      let bodySnippet: string | undefined
      try {
        const bodyText = await response.text()
        bodySnippet = bodyText.slice(0, 2000)
      } catch {
        bodySnippet = undefined
      }

      return {
        statusCode,
        redirectUrl: null,
        finalUrl: url,
        contentType,
        bodySnippet,
        error: `HTTP_ERROR_${statusCode}`,
      }
    }

    // ============================================
    // 处理正常响应 (2xx)
    // ============================================
    
    // 检查是否为 HTML 内容
    const isHtml = contentType?.toLowerCase().includes('text/html')
    
    if (!isHtml) {
      // 非 HTML 内容，无需解析 meta/js 重定向
      return {
        statusCode,
        redirectUrl: null,
        finalUrl: url,
        contentType,
      }
    }

    // 读取 HTML 内容
    let htmlBody: string
    try {
      htmlBody = await response.text()
    } catch (err) {
      return {
        statusCode,
        redirectUrl: null,
        finalUrl: url,
        contentType,
        error: `READ_BODY_ERROR: ${err instanceof Error ? err.message : String(err)}`,
      }
    }

    // 解析 Meta Refresh 或 JavaScript 跳转
    const htmlRedirect = extractHtmlRedirectUrl(htmlBody, url)
    
    if (htmlRedirect) {
      return {
        statusCode,
        redirectUrl: htmlRedirect.url,
        finalUrl: url,
        redirectType: htmlRedirect.type,
        contentType,
        bodySnippet: htmlBody.slice(0, 2000),
      }
    }

    // 无重定向
    return {
      statusCode,
      redirectUrl: null,
      finalUrl: url,
      contentType,
      bodySnippet: htmlBody.slice(0, 2000),
    }

  } catch (err) {
    // 处理各种错误，返回友好的错误信息
    const error = err instanceof Error ? err : new Error(String(err))
    
    let errorCode = 'REQUEST_FAILED'
    let friendlyMessage = error.message
    
    if (error.name === 'AbortError') {
      errorCode = 'TIMEOUT'
      friendlyMessage = '请求超时，代理或目标服务器响应过慢'
    } else if (error.message.includes('ECONNREFUSED')) {
      errorCode = 'CONNECTION_REFUSED'
      friendlyMessage = '连接被拒绝，代理服务器可能不可用'
    } else if (error.message.includes('ENOTFOUND')) {
      errorCode = 'DNS_ERROR'
      friendlyMessage = 'DNS 解析失败，域名可能无效'
    } else if (error.message.includes('CERT') || error.message.includes('SSL')) {
      errorCode = 'SSL_ERROR'
      friendlyMessage = 'SSL 证书验证失败'
    } else if (error.message.includes('socket hang up')) {
      errorCode = 'CONNECTION_RESET'
      friendlyMessage = '连接被重置，服务器可能中断了连接'
    } else if (error.message.includes('ETIMEDOUT')) {
      errorCode = 'TIMEOUT'
      friendlyMessage = '连接超时，网络可能不稳定'
    } else if (error.message.includes('ECONNRESET')) {
      errorCode = 'CONNECTION_RESET'
      friendlyMessage = '连接被重置'
    }

    return {
      statusCode: 0,
      redirectUrl: null,
      finalUrl: url,
      error: `${errorCode}: ${friendlyMessage}`,
    }
  }
}

/**
 * 将 Location 头解析为绝对 http(s) URL
 * 
 * @param location Location 头的值
 * @param baseUrl 基准 URL
 * @returns 绝对 URL，如果无效则返回 null
 */
function resolveToAbsoluteHttpUrl(location: string, baseUrl: string): string | null {
  if (!location || typeof location !== 'string') {
    return null
  }

  try {
    // 处理协议相对 URL
    let url = location.trim()
    if (url.startsWith('//')) {
      const baseProtocol = new URL(baseUrl).protocol
      url = baseProtocol + url
    }

    // 解析为绝对 URL
    const urlObj = new URL(url, baseUrl)

    // 验证协议
    if (urlObj.protocol !== 'http:' && urlObj.protocol !== 'https:') {
      return null
    }

    return urlObj.href
  } catch {
    return null
  }
}

// ============================================
// 追踪器类
// ============================================

/**
 * 重定向追踪器类
 * 
 * TODO: 实现具体的追踪逻辑
 */
export class RedirectTracker implements IRedirectTracker {
  private options: TrackerOptions

  constructor(options: TrackerOptions = {}) {
    this.options = options
  }

  /**
   * 追踪联盟链接的重定向链路
   */
  async trace(request: AffiliateVerifyRequest): Promise<AffiliateVerifyResponse> {
    // TODO: 实现追踪逻辑
    throw new Error('Not implemented')
  }

  /**
   * 执行单次请求并解析响应
   * 使用 singleRequest 函数
   */
  private async executeRequest(url: string, referrer?: string): Promise<TraceResult> {
    const result = await singleRequest(url, {
      proxy: this.options.proxy ? {
        url: `${this.options.proxy.protocol}://${this.options.proxy.proxyIp}:${this.options.proxy.port}`,
        username: this.options.proxy.username,
        password: this.options.proxy.password,
      } : undefined,
      referer: referrer,
      timeout: this.options.timeout,
      userAgent: this.options.userAgent,
      headers: this.options.headers,
    })

    return {
      success: !result.error,
      statusCode: result.statusCode,
      nextUrl: result.redirectUrl ?? undefined,
      redirectType: result.redirectType,
      body: result.bodySnippet,
      error: result.error,
    }
  }

  /**
   * 从响应头解析 HTTP 重定向
   */
  private parseHttpRedirect(statusCode: number, headers: Record<string, string>): string | null {
    if (!isRedirectStatusCode(statusCode)) {
      return null
    }
    const location = headers['location'] || headers['Location']
    return location || null
  }

  /**
   * 从响应体解析重定向（Meta Refresh 或 JavaScript）
   * 使用 extractHtmlRedirectUrl 函数
   */
  private parseHtmlRedirect(body: string, baseUrl: string): HtmlRedirectResult | null {
    return extractHtmlRedirectUrl(body, baseUrl)
  }
}

// ============================================
// 工具函数
// ============================================

/**
 * 从 URL 中提取域名
 */
export function extractDomain(url: string): string {
  try {
    const urlObj = new URL(url)
    return urlObj.hostname
  } catch {
    return ''
  }
}

/**
 * 判断是否为 HTTP 重定向状态码
 */
export function isRedirectStatusCode(statusCode: number): boolean {
  return [301, 302, 303, 307, 308].includes(statusCode)
}

/**
 * 解析相对 URL 为绝对 URL
 */
export function resolveUrl(baseUrl: string, relativeUrl: string): string {
  try {
    return new URL(relativeUrl, baseUrl).href
  } catch {
    return relativeUrl
  }
}

// ============================================
// 测试用例
// ============================================

/**
 * 运行 extractHtmlRedirectUrl 测试用例
 */
export function runHtmlRedirectTests(): void {
  console.log('=== extractHtmlRedirectUrl 测试用例 ===\n')

  const baseUrl = 'https://example.com/page'

  const testCases = [
    // Meta Refresh 测试
    {
      name: '用例1: Meta Refresh 标准格式',
      html: '<html><head><meta http-equiv="refresh" content="0;url=https://target.com/landing"></head></html>',
      expected: { url: 'https://target.com/landing', type: 'meta' },
    },
    {
      name: '用例2: Meta Refresh 相对路径',
      html: '<meta http-equiv="refresh" content="5; url=/new-page">',
      expected: { url: 'https://example.com/new-page', type: 'meta' },
    },
    {
      name: '用例3: Meta Refresh 带引号',
      html: '<meta http-equiv="refresh" content="0;url=\'https://target.com\'">',
      expected: { url: 'https://target.com/', type: 'meta' },
    },
    
    // JavaScript 跳转测试
    {
      name: '用例4: window.location.href',
      html: '<script>window.location.href = "https://target.com/js-redirect";</script>',
      expected: { url: 'https://target.com/js-redirect', type: 'js' },
    },
    {
      name: '用例5: location.href 相对路径',
      html: '<script>location.href = "/relative/path";</script>',
      expected: { url: 'https://example.com/relative/path', type: 'js' },
    },
    {
      name: '用例6: location.replace',
      html: '<script>location.replace("https://target.com/replaced");</script>',
      expected: { url: 'https://target.com/replaced', type: 'js' },
    },
    {
      name: '用例7: location.assign',
      html: '<script>window.location.assign("/assigned");</script>',
      expected: { url: 'https://example.com/assigned', type: 'js' },
    },
    {
      name: '用例8: document.location',
      html: '<script>document.location = "https://target.com/doc";</script>',
      expected: { url: 'https://target.com/doc', type: 'js' },
    },
    {
      name: '用例9: self.location',
      html: '<script>self.location.href = "https://target.com/self";</script>',
      expected: { url: 'https://target.com/self', type: 'js' },
    },
    {
      name: '用例10: top.location',
      html: '<script>top.location = "https://target.com/top";</script>',
      expected: { url: 'https://target.com/top', type: 'js' },
    },
    {
      name: '用例11: setTimeout 包裹',
      html: '<script>setTimeout(function(){ location.href = "https://target.com/timeout"; }, 1000);</script>',
      expected: { url: 'https://target.com/timeout', type: 'js' },
    },
    {
      name: '用例12: 协议相对 URL (//)',
      html: '<script>location.href = "//target.com/protocol-relative";</script>',
      expected: { url: 'https://target.com/protocol-relative', type: 'js' },
    },
    
    // 过滤测试
    {
      name: '用例13: 过滤 javascript:',
      html: '<script>location.href = "javascript:void(0)";</script>',
      expected: null,
    },
    {
      name: '用例14: 过滤 mailto:',
      html: '<meta http-equiv="refresh" content="0;url=mailto:test@example.com">',
      expected: null,
    },
    {
      name: '用例15: 过滤相同 URL（防止死循环）',
      html: '<script>location.href = "https://example.com/page";</script>',
      expected: null,
    },
    
    // 无重定向
    {
      name: '用例16: 无重定向的普通 HTML',
      html: '<html><head><title>Hello</title></head><body>Normal page</body></html>',
      expected: null,
    },
    
    // 单引号和反引号
    {
      name: '用例17: 单引号',
      html: "<script>location.href = 'https://target.com/single-quote';</script>",
      expected: { url: 'https://target.com/single-quote', type: 'js' },
    },
    {
      name: '用例18: 模板字符串（反引号）',
      html: '<script>location.href = `https://target.com/template`;</script>',
      expected: { url: 'https://target.com/template', type: 'js' },
    },
  ]

  let passed = 0
  let failed = 0

  for (const tc of testCases) {
    const result = extractHtmlRedirectUrl(tc.html, baseUrl)
    
    const isPass = tc.expected === null
      ? result === null
      : result !== null && result.url === tc.expected.url && result.type === tc.expected.type

    if (isPass) {
      console.log(`✅ ${tc.name}`)
      passed++
    } else {
      console.log(`❌ ${tc.name}`)
      console.log(`   期望: ${JSON.stringify(tc.expected)}`)
      console.log(`   实际: ${JSON.stringify(result)}`)
      failed++
    }
  }

  console.log(`\n=== 测试结果: ${passed} 通过, ${failed} 失败 ===`)
}

// ============================================
// trackRedirects 类型定义
// ============================================

/**
 * 可重试的网络错误类型
 */
const RETRYABLE_ERRORS = [
  'AbortError',
  'ECONNRESET',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EAI_AGAIN',
  'TIMEOUT',
  'CONNECTION_RESET',
  'DNS_ERROR',
  'socket hang up',
]

/**
 * 判断错误是否可重试
 */
function isRetryableError(error: string): boolean {
  return RETRYABLE_ERRORS.some(e => error.includes(e))
}

/**
 * trackRedirects 配置选项
 */
export interface TrackRedirectsOptions {
  /** 起始 URL（必填） */
  url: string
  
  /** 代理配置 */
  proxy?: SingleRequestProxy
  
  /** 目标域名（用于早停判断） */
  targetDomain?: string
  
  /** 第一跳的 Referer（默认 https://t.co） */
  initialReferer?: string
  
  /** 最大重定向次数（默认 10） */
  maxRedirects?: number
  
  /** 单次请求超时时间（毫秒，默认 10000） */
  requestTimeout?: number
  
  /** 总超时时间（毫秒，默认 60000） */
  totalTimeout?: number
  
  /** 网络错误重试次数（默认 2） */
  retryCount?: number
  
  /** 自定义 User-Agent */
  userAgent?: string
  
  /** 额外的请求头 */
  headers?: Record<string, string>
}

/**
 * 重定向步骤详细信息
 */
export interface RedirectStepInfo {
  /** 步骤序号（从 1 开始） */
  step: number
  
  /** 当前 URL */
  url: string
  
  /** 域名 */
  domain: string
  
  /** HTTP 状态码 */
  statusCode: number
  
  /** 重定向类型 */
  redirectType?: 'http' | 'meta' | 'js'
  
  /** 下一跳 URL（如果有） */
  nextUrl?: string
  
  /** 该步骤耗时（毫秒） */
  duration?: number
  
  /** 错误信息（如果有） */
  error?: string
}

/**
 * 域名验证结果
 */
export interface DomainValidation {
  /** 是否匹配目标域名 */
  isValid: boolean
  
  /** 目标根域名 */
  targetDomain: string
  
  /** 实际根域名 */
  actualDomain: string
}

/**
 * trackRedirects 返回结果
 */
export interface TrackRedirectsResult {
  /** 是否成功（无错误且状态码 < 400） */
  success: boolean
  
  /** 最终落地页 URL */
  finalUrl: string
  
  /** 最终状态码 */
  finalStatusCode: number
  
  /** 重定向次数 */
  redirectCount: number
  
  /** 重定向链（URL 数组） */
  redirectChain: string[]
  
  /** 重定向步骤详情 */
  redirectSteps: RedirectStepInfo[]
  
  /** 总耗时（毫秒） */
  duration: number
  
  /** 域名验证结果（当传入 targetDomain 时） */
  domainValidation?: DomainValidation
  
  /** 错误信息 */
  errorMessage?: string
  
  /** 是否因早停而结束 */
  earlyStop?: boolean
}

// ============================================
// trackRedirects 核心函数
// ============================================

/**
 * 追踪完整重定向链路
 * 
 * 功能：
 * - 支持 HTTP 重定向、Meta Refresh、JavaScript 跳转
 * - 支持代理
 * - 支持网络错误重试
 * - 支持目标域名早停
 * - 支持超时控制（单次 + 总超时）
 * 
 * @param options 配置选项
 * @returns 追踪结果
 * 
 * @example
 * const result = await trackRedirects({
 *   url: 'https://affiliate.example.com/link',
 *   targetDomain: 'amazon.com',
 *   initialReferer: 'https://t.co',
 *   proxy: { url: 'http://proxy.example.com:8080' },
 * })
 */
export async function trackRedirects(options: TrackRedirectsOptions): Promise<TrackRedirectsResult> {
  const startTime = Date.now()
  
  // 默认值
  const maxRedirects = options.maxRedirects ?? 10
  const requestTimeout = options.requestTimeout ?? 10000
  const totalTimeout = options.totalTimeout ?? 60000
  const retryCount = options.retryCount ?? 2
  const initialReferer = options.initialReferer ?? 'https://t.co'
  
  // 状态变量
  const redirectChain: string[] = []
  const redirectSteps: RedirectStepInfo[] = []
  let currentUrl = options.url
  let previousUrl: string | null = null
  let finalStatusCode = 0
  let errorMessage: string | undefined
  let earlyStop = false
  
  // 将起始 URL 加入链路
  redirectChain.push(currentUrl)
  
  // 循环追踪重定向
  for (let i = 0; i < maxRedirects; i++) {
    // 检查总超时
    if (Date.now() - startTime > totalTimeout) {
      errorMessage = `TOTAL_TIMEOUT: 总耗时超过 ${totalTimeout}ms`
      break
    }
    
    const stepStartTime = Date.now()
    const stepNumber = i + 1
    
    // 确定本次请求的 Referer
    // 第 1 跳：使用 initialReferer
    // 第 2 跳开始：使用上一跳 URL
    const referer = stepNumber === 1 ? initialReferer : previousUrl ?? undefined
    
    // 早停检查：如果目标域名存在，检查当前 URL 是否已匹配
    if (options.targetDomain && stepNumber > 1) {
      const currentRootDomain = extractRootDomain(currentUrl)
      const targetRootDomain = extractRootDomain(options.targetDomain) ?? normalizeDomain(options.targetDomain)
      
      if (currentRootDomain && targetRootDomain) {
        const normalizedCurrent = normalizeDomain(currentRootDomain)
        const normalizedTarget = normalizeDomain(targetRootDomain)
        
        if (normalizedCurrent === normalizedTarget) {
          // 域名匹配，早停（不再访问该 URL）
          earlyStop = true
          break
        }
      }
    }
    
    // 执行请求（带重试）
    let result: SingleRequestResult | null = null
    let lastError: string | undefined
    
    for (let retry = 0; retry <= retryCount; retry++) {
      try {
        result = await singleRequest(currentUrl, {
          proxy: options.proxy,
          timeout: requestTimeout,
          referer,
          userAgent: options.userAgent,
          headers: options.headers,
        })
        
        // 如果没有错误或错误不可重试，跳出重试循环
        if (!result.error || !isRetryableError(result.error)) {
          break
        }
        
        lastError = result.error
        
        // 可重试错误，等待后重试
        if (retry < retryCount) {
          await sleep(100 * (retry + 1)) // 递增等待时间
        }
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err)
        
        if (retry < retryCount && isRetryableError(lastError)) {
          await sleep(100 * (retry + 1))
        }
      }
    }
    
    const stepDuration = Date.now() - stepStartTime
    
    // 如果请求完全失败
    if (!result) {
      redirectSteps.push({
        step: stepNumber,
        url: currentUrl,
        domain: extractDomain(currentUrl),
        statusCode: 0,
        duration: stepDuration,
        error: lastError ?? 'REQUEST_FAILED',
      })
      errorMessage = lastError ?? 'REQUEST_FAILED'
      break
    }
    
    finalStatusCode = result.statusCode
    
    // 记录步骤信息
    const stepInfo: RedirectStepInfo = {
      step: stepNumber,
      url: currentUrl,
      domain: extractDomain(currentUrl),
      statusCode: result.statusCode,
      redirectType: result.redirectType,
      nextUrl: result.redirectUrl ?? undefined,
      duration: stepDuration,
      error: result.error,
    }
    redirectSteps.push(stepInfo)
    
    // 处理错误响应 (4xx/5xx)
    if (result.statusCode >= 400) {
      const snippet = result.bodySnippet?.slice(0, 500) ?? ''
      errorMessage = `HTTP_ERROR_${result.statusCode}: ${snippet}`
      break
    }
    
    // 如果有请求级错误但状态码正常，记录错误但继续
    if (result.error && result.statusCode === 0) {
      errorMessage = result.error
      break
    }
    
    // 检查是否有重定向
    if (!result.redirectUrl) {
      // 无重定向，追踪结束
      break
    }
    
    // 更新状态，准备下一跳
    previousUrl = currentUrl
    currentUrl = result.redirectUrl
    redirectChain.push(currentUrl)
  }
  
  // 计算总耗时
  const duration = Date.now() - startTime
  
  // 构建域名验证结果
  let domainValidation: DomainValidation | undefined
  if (options.targetDomain) {
    const actualRootDomain = extractRootDomain(currentUrl)
    const targetRootDomain = extractRootDomain(options.targetDomain) ?? normalizeDomain(options.targetDomain)
    
    const actualDomain = actualRootDomain ? normalizeDomain(actualRootDomain) : ''
    const targetDomain = targetRootDomain ? normalizeDomain(targetRootDomain) : ''
    
    domainValidation = {
      isValid: actualDomain !== '' && targetDomain !== '' && actualDomain === targetDomain,
      targetDomain,
      actualDomain,
    }
  }
  
  // 判断是否成功
  const success = !errorMessage && finalStatusCode > 0 && finalStatusCode < 400
  
  return {
    success,
    finalUrl: currentUrl,
    finalStatusCode,
    redirectCount: redirectChain.length - 1, // 不包括起始 URL
    redirectChain,
    redirectSteps,
    duration,
    domainValidation,
    errorMessage,
    earlyStop,
  }
}

/**
 * 延迟函数
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
