/**
 * 联盟商家数据同步 API
 * 
 * POST /api/v1/affiliate-networks/sync
 * 
 * 功能：从联盟平台 API 获取商家数据并保存到数据库
 * 支持：实时进度推送（Server-Sent Events）
 */

import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticateRequest } from '@/lib/auth'

// ============================================
// 配置
// ============================================

/** 并发请求数 */
const CONCURRENCY = 5

/** 每页数量 */
const PAGE_SIZE = 1000

/** 联盟类型枚举 */
type NetworkType = 'RW' | 'LH' | 'PM' | 'LB' | 'CG' | 'CF' | 'BSH'

/** 联盟 API 配置 */
interface AffiliateApiConfig {
  url: string
  type: NetworkType
  // HTTP 方法：GET 或 POST
  httpMethod: 'GET' | 'POST'
  // 请求格式：form = application/x-www-form-urlencoded, json = application/json, query = URL query string
  requestFormat: 'form' | 'json' | 'query'
  // 请求参数配置
  paramNames: {
    page: string        // 页码参数名
    pageSize: string    // 每页数量参数名
    relationship?: string // 关系筛选参数名（可选）
  }
  // 响应字段映射
  fieldMapping: {
    mid: string         // 商家唯一标识字段名
    totalPage: string   // 总页数字段名
    totalCount: string  // 总数量字段名
    list: string        // 列表字段名
  }
  // 响应格式：wrapped = { status/code, data }, flat = 直接返回数据
  responseFormat: 'wrapped' | 'flat'
  // 响应状态码字段（PM 用 code 字符串，RW 用 status.code 数字）
  statusCodeField?: string
  // 并发数（不同联盟可能有不同的限制）
  concurrency?: number
  // 请求间隔（毫秒）
  requestDelay?: number
  // 额外请求参数
  extraParams?: Record<string, string>
}

const AFFILIATE_API_CONFIG: Record<string, AffiliateApiConfig> = {
  // Rewardoo 联盟 - 响应格式: { status: { code, msg }, data: { list, total_page, ... } }
  RW: {
    url: 'https://admin.rewardoo.com/api.php?mod=medium&op=merchant_details',
    type: 'RW',
    httpMethod: 'POST',
    requestFormat: 'form',      // form-urlencoded
    paramNames: {
      page: 'page',
      pageSize: 'limit',
      relationship: 'relationship',
    },
    fieldMapping: {
      mid: 'mid',
      totalPage: 'total_page',
      totalCount: 'total_mcid',
      list: 'list',
    },
    responseFormat: 'wrapped',  // RW: { status, data }
    concurrency: 5,             // RW 支持较高并发
    extraParams: {
      relationship: 'Joined',
    },
  },
  // LinkHaitao 联盟 - 响应格式: { list: [...], total: "9107" } (直接返回数据)
  // 注意：LH 服务器对并发请求限制较严，容易 504 超时
  LH: {
    url: 'https://www.linkhaitao.com/api.php?mod=medium&op=merchantBasicList3',
    type: 'LH',
    httpMethod: 'POST',
    requestFormat: 'form',      // form-urlencoded
    paramNames: {
      page: 'page',
      pageSize: 'per_page',
    },
    fieldMapping: {
      mid: 'm_id',           // LH 用 m_id
      totalPage: 'total_page',
      totalCount: 'total',   // LH 用 total (字符串)
      list: 'list',
    },
    responseFormat: 'flat',    // LH: 直接返回数据，无 status 包装
    concurrency: 2,            // LH 服务器限制，降低并发数
    requestDelay: 500,         // 每批请求后延迟 500ms
    extraParams: {
      merchant_status: '1',  // 只获取在线商家
    },
  },
  // Partnermatic 联盟 - 响应格式: { code: "0", message: "success", data: { total_mcid, total_page, list } }
  // 注意：PM 使用 JSON 请求格式，实际返回 snake_case 字段（与文档不符）
  PM: {
    url: 'https://api.partnermatic.com/api/monetization',
    type: 'PM',
    httpMethod: 'POST',
    requestFormat: 'json',      // JSON 格式
    paramNames: {
      page: 'curPage',          // PM 用 curPage
      pageSize: 'perPage',      // PM 用 perPage
    },
    fieldMapping: {
      mid: 'brand_id',          // PM 的 mid 实际是 brand_id（Brand ID）
      totalPage: 'total_page',  // 实际是 snake_case
      totalCount: 'total_mcid', // 实际是 snake_case
      list: 'list',
    },
    responseFormat: 'wrapped',  // PM: { code, message, data }
    statusCodeField: 'code',    // PM 的状态码字段名
    concurrency: 3,             // PM 适中并发
    extraParams: {
      source: 'partnermatic',   // PM 必需的 source 参数
      relationship: 'Joined',   // 只获取已加入的商家
    },
  },
  // Linkbux 联盟 - 响应格式: { status: { code, msg }, data: { total_mcid, total_page, list } }
  // 注意：LB 使用 GET 方法，参数通过 URL query string 传递
  LB: {
    url: 'https://www.linkbux.com/api.php?mod=medium&op=monetization_api',
    type: 'LB',
    httpMethod: 'GET',          // LB 使用 GET 方法
    requestFormat: 'query',     // 参数通过 URL query string 传递
    paramNames: {
      page: 'page',
      pageSize: 'limit',
    },
    fieldMapping: {
      mid: 'mid',
      totalPage: 'total_page',
      totalCount: 'total_mcid',
      list: 'list',
    },
    responseFormat: 'wrapped',  // LB: { status, data }，与 RW 格式相同
    concurrency: 3,             // LB 适中并发
    extraParams: {
      relationship: 'Joined',   // 只获取已加入的商家
    },
  },
  // CollabGlow 联盟 - 响应格式: { code: "0", message: "success", data: { total_mcid, total_page, list } }
  // 注意：CG 使用 JSON 请求格式，与 PM 格式非常相似，返回 snake_case 字段
  CG: {
    url: 'https://api.collabglow.com/api/monetization',
    type: 'CG',
    httpMethod: 'POST',
    requestFormat: 'json',      // JSON 格式
    paramNames: {
      page: 'curPage',          // CG 用 curPage（与 PM 相同）
      pageSize: 'perPage',      // CG 用 perPage（与 PM 相同）
    },
    fieldMapping: {
      mid: 'mid',               // CG 的 mid 为数字形式（必要时回退 brand_id）
      totalPage: 'total_page',  // snake_case
      totalCount: 'total_mcid', // snake_case
      list: 'list',
    },
    responseFormat: 'wrapped',  // CG: { code, message, data }
    statusCodeField: 'code',    // CG 的状态码字段名
    concurrency: 3,             // CG 适中并发
    extraParams: {
      source: 'collabglow',     // CG 必需的 source 参数
      relationship: 'Joined',   // 只获取已加入的商家
    },
  },
  // CreatorFlare 联盟 - 响应格式: { code: "0", message: "success", data: { total_mcid, total_page, list } }
  // 注意：CF 使用 JSON 请求格式，与 PM/CG 格式完全相同
  CF: {
    url: 'https://api.creatorflare.com/api/monetization',
    type: 'CF',
    httpMethod: 'POST',
    requestFormat: 'json',      // JSON 格式
    paramNames: {
      page: 'curPage',          // CF 用 curPage
      pageSize: 'perPage',      // CF 用 perPage
    },
    fieldMapping: {
      mid: 'mcid',              // CF 用 mcid 作为唯一标识（mid 已弃用）
      totalPage: 'total_page',  // snake_case
      totalCount: 'total_mcid', // snake_case
      list: 'list',
    },
    responseFormat: 'wrapped',  // CF: { code, message, data }
    statusCodeField: 'code',    // CF 的状态码字段名
    concurrency: 3,             // CF 适中并发
    extraParams: {
      source: 'creatorflare',   // CF 必需的 source 参数
      relationship: 'Joined',   // 只获取已加入的商家
    },
  },
  // BrandSparkHub 联盟 - 响应格式: { code: "0", message: "success", data: { total_mcid, total_page, list } }
  // 注意：BSH 使用 JSON 请求格式，与 PM/CG 格式非常相似，返回 snake_case 字段
  BSH: {
    url: 'https://api.brandsparkhub.com/api/monetization',
    type: 'BSH',
    httpMethod: 'POST',
    requestFormat: 'json',      // JSON 格式
    paramNames: {
      page: 'curPage',          // BSH 用 curPage（与 PM/CG 相同）
      pageSize: 'perPage',      // BSH 用 perPage（与 PM/CG 相同），最大 2000
    },
    fieldMapping: {
      mid: 'mcid',              // BSH 用 mcid 作为唯一标识（mid 已弃用）
      totalPage: 'total_page',  // snake_case
      totalCount: 'total_mcid', // snake_case
      list: 'list',
    },
    responseFormat: 'wrapped',  // BSH: { code, message, data }
    statusCodeField: 'code',    // BSH 的状态码字段名
    concurrency: 3,             // BSH 适中并发
    extraParams: {
      source: 'brandsparkhub',  // BSH 必需的 source 参数
      relationship: 'Joined',   // 只获取已加入的商家
    },
  },
}

// ============================================
// 类型定义
// ============================================

/** 通用商家信息（规范化后） */
interface NormalizedMerchant {
  mcid: string
  mid: string              // 统一使用 mid
  merchant_name: string
  site_url: string
  tracking_url: string
  merchant_status: string
  relationship?: string
}

/** RW 原始商家数据 */
interface RWMerchantRaw {
  mcid: string
  mid: string
  merchant_name: string
  site_url: string
  tracking_url: string
  merchant_status: string
  relationship: string
  primary_region?: string
  offer_type?: string
  support_deeplink?: string
}

/** LH 原始商家数据 */
interface LHMerchantRaw {
  mcid: string
  m_id: string              // LH 用 m_id
  merchant_name: string
  site_url: string
  tracking_url: string
  merchant_status: string
  relationship?: string
  country?: string
  offer_type?: string
  support_deeplink?: string
}

/** PM 原始商家数据 (实际返回 snake_case 格式，与 RW/LH 一致) */
interface PMMerchantRaw {
  mcid: string              // 唯一标识
  brand_id: number          // 品牌 ID
  merchant_name: string     // snake_case
  site_url: string          // snake_case
  tracking_url: string | null // snake_case，可能为 null
  tracking_url_short?: string | null
  brand_status: string      // snake_case: "Online" | "Offline"
  relationship?: string
  country?: string
  offer_type?: string       // snake_case
  allow_sml?: string        // 是否支持深链
  comm_rate?: string
}

/** LB 原始商家数据 (与 RW 格式类似) */
interface LBMerchantRaw {
  mcid: string
  mid: string
  merchant_name: string
  site_url: string
  tracking_url: string
  tracking_url_short?: string
  tracking_url_smart?: string
  merchant_status: string
  relationship: string
  primary_region?: string
  support_region?: string
  offer_type?: string
  support_deeplink?: string
  comm_rate?: string
}

/** CG (CollabGlow) 原始商家数据 (与 PM 格式类似，使用 snake_case) */
interface CGMerchantRaw {
  id: number                // CG 实际返回的唯一 id
  mcid: string              // 唯一标识
  mid: number | string      // 数字形式的 mid
  brand_id: number          // 品牌 ID
  merchant_name: string     // snake_case
  site_url: string          // snake_case
  tracking_url: string | null // snake_case，可能为 null
  tracking_url_short?: string | null
  brand_status: string      // snake_case: "Online" | "Offline"
  merchant_status?: string  // 也有 merchant_status 字段
  relationship?: string
  country?: string
  offer_type?: string       // snake_case
  allow_sml?: string        // 是否支持深链
  comm_rate?: string
}

/** CF (CreatorFlare) 原始商家数据 (与 PM/CG 格式完全相同，使用 snake_case) */
interface CFMerchantRaw {
  mcid: string              // 唯一标识
  mid: number               // 已弃用，使用 mcid
  brand_id: number          // 品牌 ID
  merchant_name: string     // 品牌名称
  site_url: string          // 品牌首页 URL
  tracking_url: string | null // 追踪链接，可能为 null
  tracking_url_short?: string | null // 短链接
  brand_status: string      // "Online" | "Offline"
  merchant_status?: string  // 商家状态
  relationship?: string     // 关系: "Joined" 等
  country?: string          // 国家代码
  offer_type?: string       // 定价模式: "CPS" 等
  allow_sml?: string        // 是否支持深链: "Y" | "N"
  comm_rate?: string        // 佣金率
}

/** BSH (BrandSparkHub) 原始商家数据 (与 PM/CG 格式类似，使用 snake_case) */
interface BSHMerchantRaw {
  mcid: string              // 唯一标识
  mid: number               // 已弃用，使用 mcid
  brand_id: number          // 品牌 ID
  merchant_name: string     // 品牌名称
  site_url: string          // 品牌首页 URL
  tracking_url: string | null // 追踪链接，可能为 null
  tracking_url_short?: string | null // 短链接
  tracking_url_smart?: string | null // 智能链接
  brand_status: string      // "Online" | "Offline"
  merchant_status?: string  // 商家状态
  relationship?: string     // 关系: "Joined" 等
  country?: string          // 国家代码
  support_region?: string   // 支持地区
  offer_type?: string       // 定价模式: "CPS" 等
  allow_sml?: string        // 是否支持深链: "Y" | "N"
  comm_rate?: string        // 佣金率
  comm_detail?: string | null // 佣金详情
  RD?: string               // Cookie 有效期
  site_desc?: string        // 品牌描述
  categories?: string       // 品牌分类
  tags?: string | null      // 标签
  avg_payment_cycle?: number // 平均付款周期
  avg_payout?: string       // 平均佣金率
  post_area_list?: string[] // 配送地区列表
  support_couponordeal?: string // 是否支持优惠券: "1" | "0" | "-"
}

/** RW 联盟 API 响应格式 (wrapped with status) */
interface RWApiResponse {
  status: {
    code: number
    msg: string
  }
  data: Record<string, unknown>
}

/** PM 联盟 API 响应格式 (wrapped with code) */
interface PMApiResponse {
  code: string | number      // PM 的 code 可能是字符串 "0"
  message: string
  data: Record<string, unknown>
}

/** LH 联盟 API 响应格式 (flat) */
interface FlatApiResponse extends Record<string, unknown> {
  list?: unknown[]
  total?: string | number
  total_page?: number
}

interface SyncProgress {
  stage: 'init' | 'fetching' | 'saving' | 'done' | 'error'
  current: number
  total: number
  message: string
  networkName?: string
  debug?: {
    rawResponsePreview?: Record<string, unknown>
    rawMerchantSample?: Record<string, unknown>
    normalizedSample?: NormalizedMerchant
  }
}

// ============================================
// 工具函数
// ============================================

/**
 * 从 site_url 提取域名
 */
function extractDomain(url: string): string {
  if (!url) return ''
  try {
    const parsed = new URL(url)
    return parsed.hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

/** 规范化的分页响应 */
interface NormalizedPageResponse {
  success: boolean
  errorMsg?: string
  totalPage: number
  totalCount: number
  merchants: NormalizedMerchant[]
  rawResponsePreview?: Record<string, unknown>
  rawMerchantSample?: Record<string, unknown>
  normalizedSample?: NormalizedMerchant
}

/**
 * 调用联盟 API 获取商家数据
 */
async function fetchMerchantPage(
  config: AffiliateApiConfig,
  token: string,
  page: number,
  pageSize: number
): Promise<NormalizedPageResponse> {
  let response: Response
  
  // 构建请求参数
  const params = new URLSearchParams({
    token,
    [config.paramNames.page]: String(page),
    [config.paramNames.pageSize]: String(pageSize),
  })
  
  // 添加额外参数
  if (config.extraParams) {
    Object.entries(config.extraParams).forEach(([key, value]) => {
      params.set(key, value)
    })
  }

  if (config.requestFormat === 'json') {
    // JSON 请求格式（PM 使用）
    const jsonBody: Record<string, string | number> = {
      token,
      [config.paramNames.page]: page,
      [config.paramNames.pageSize]: pageSize,
    }
    
    // 添加额外参数
    if (config.extraParams) {
      Object.entries(config.extraParams).forEach(([key, value]) => {
        jsonBody[key] = value
      })
    }

    response = await fetch(config.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(jsonBody),
    })
  } else if (config.requestFormat === 'query' || config.httpMethod === 'GET') {
    // URL query string 格式（LB 使用 GET 方法）
    const urlWithParams = `${config.url}&${params.toString()}`
    
    response = await fetch(urlWithParams, {
      method: 'GET',
    })
  } else {
    // Form-urlencoded 请求格式（RW/LH 使用 POST）
    response = await fetch(config.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    })
  }

  if (!response.ok) {
    throw new Error(`HTTP 错误: ${response.status}`)
  }

  const rawResponse = await response.json()
  
  // 根据响应格式解析数据
  let data: Record<string, unknown>
  
  if (config.responseFormat === 'wrapped') {
    // 检查是否使用 code 字段作为状态码（PM/CG/CF/BSH 格式）
    if (config.statusCodeField === 'code') {
      // PM/CG/CF/BSH 格式: { code: "0", message: "success", data: {...} }
      const pmResponse = rawResponse as PMApiResponse
      // code 可能是字符串 "0" 或数字 0
      if (String(pmResponse.code) !== '0') {
        return {
          success: false,
          errorMsg: pmResponse.message || '联盟 API 返回错误',
          totalPage: 0,
          totalCount: 0,
          merchants: [],
        }
      }
      data = pmResponse.data
    } else {
      // RW 格式: { status: { code, msg }, data: {...} }
      const rwResponse = rawResponse as RWApiResponse
      if (rwResponse.status?.code !== 0) {
        return {
          success: false,
          errorMsg: rwResponse.status?.msg || '联盟 API 返回错误',
          totalPage: 0,
          totalCount: 0,
          merchants: [],
        }
      }
      data = rwResponse.data
    }
  } else {
    // LH 格式: { list: [...], total: "9107", ... } 直接返回数据
    data = rawResponse as FlatApiResponse
  }

  // 根据配置提取字段
  const rawList = (data[config.fieldMapping.list] || []) as (RWMerchantRaw | LHMerchantRaw | PMMerchantRaw | LBMerchantRaw | CGMerchantRaw | CFMerchantRaw | BSHMerchantRaw)[]
  
  // 计算总页数（LH 没有 total_page，需要从 total 计算）
  let totalPage = Number(data[config.fieldMapping.totalPage]) || 0
  const totalCount = Number(data[config.fieldMapping.totalCount]) || rawList.length
  
  // 如果没有 total_page，从 total 计算
  if (!totalPage && totalCount > 0) {
    totalPage = Math.ceil(totalCount / pageSize)
  }
  if (totalPage === 0) totalPage = 1

  // 规范化商家数据
  const merchants = rawList.map(raw => normalizeMerchant(raw, config.type))

  const firstRaw = (rawList[0] || null) as Record<string, unknown> | null
  const responsePreview: Record<string, unknown> = {
    responseKeys: Object.keys(rawResponse || {}),
    dataKeys: Object.keys((data || {}) as Record<string, unknown>),
    totalPage: data[config.fieldMapping.totalPage],
    totalCount: data[config.fieldMapping.totalCount],
  }

  return {
    success: true,
    totalPage,
    totalCount,
    merchants,
    rawResponsePreview: responsePreview,
    rawMerchantSample: firstRaw || undefined,
    normalizedSample: merchants[0],
  }
}

/**
 * 规范化商家数据（统一不同联盟的字段名）
 */
function normalizeMerchant(
  raw: RWMerchantRaw | LHMerchantRaw | PMMerchantRaw | LBMerchantRaw | CGMerchantRaw | CFMerchantRaw | BSHMerchantRaw,
  networkType: NetworkType
): NormalizedMerchant {
  if (networkType === 'LH') {
    const lhRaw = raw as LHMerchantRaw
    return {
      // LH: 数据库校验后确认 m_id 与 mcid 在本系统需要互换
      mcid: lhRaw.m_id,
      mid: lhRaw.mcid,
      merchant_name: lhRaw.merchant_name,
      site_url: lhRaw.site_url,
      tracking_url: lhRaw.tracking_url,
      merchant_status: lhRaw.merchant_status,
      relationship: lhRaw.relationship,
    }
  }
  
  if (networkType === 'PM') {
    const pmRaw = raw as PMMerchantRaw
    return {
      mcid: pmRaw.mcid,
      mid: String(pmRaw.brand_id),                 // PM: mid = Brand ID
      merchant_name: pmRaw.merchant_name,          // 实际是 snake_case
      site_url: pmRaw.site_url,                    // 实际是 snake_case
      tracking_url: pmRaw.tracking_url || '',      // 实际是 snake_case，可能为 null
      merchant_status: pmRaw.brand_status,         // brand_status -> merchant_status
      relationship: pmRaw.relationship,
    }
  }
  
  if (networkType === 'LB') {
    // LB 格式与 RW 类似
    const lbRaw = raw as LBMerchantRaw
    return {
      mcid: lbRaw.mcid,
      mid: lbRaw.mid,
      merchant_name: lbRaw.merchant_name,
      site_url: lbRaw.site_url,
      tracking_url: lbRaw.tracking_url,
      merchant_status: lbRaw.merchant_status,
      relationship: lbRaw.relationship,
    }
  }
  
  if (networkType === 'CG') {
    // CG 格式与 PM 类似，使用 snake_case
    const cgRaw = raw as CGMerchantRaw
    const midValue = String(cgRaw.mid || '')
    const isNumericMid = /^[0-9]+$/.test(midValue)
    return {
      mcid: cgRaw.mcid,
      // CG: mid 应为纯数字，若非数字则回退 brand_id
      mid: isNumericMid ? midValue : String(cgRaw.brand_id),
      merchant_name: cgRaw.merchant_name,
      site_url: cgRaw.site_url,
      tracking_url: cgRaw.tracking_url || '',      // 可能为 null
      merchant_status: cgRaw.brand_status || cgRaw.merchant_status || 'Unknown', // 优先用 brand_status
      relationship: cgRaw.relationship,
    }
  }
  
  if (networkType === 'CF') {
    // CF 格式与 PM/CG 完全相同，使用 snake_case
    const cfRaw = raw as CFMerchantRaw
    return {
      mcid: cfRaw.mcid,
      mid: cfRaw.mcid,                             // CF: mid 已弃用，使用 mcid
      merchant_name: cfRaw.merchant_name,
      site_url: cfRaw.site_url,
      tracking_url: cfRaw.tracking_url || '',      // 可能为 null
      merchant_status: cfRaw.brand_status || cfRaw.merchant_status || 'Unknown', // 优先用 brand_status
      relationship: cfRaw.relationship,
    }
  }
  
  if (networkType === 'BSH') {
    // BSH 格式与 PM/CG 类似，使用 snake_case
    const bshRaw = raw as BSHMerchantRaw
    return {
      mcid: bshRaw.mcid,
      mid: bshRaw.mcid,                             // BSH: mid 已弃用，使用 mcid
      merchant_name: bshRaw.merchant_name,
      site_url: bshRaw.site_url,
      tracking_url: bshRaw.tracking_url || '',      // 可能为 null
      merchant_status: bshRaw.brand_status || bshRaw.merchant_status || 'Unknown', // 优先用 brand_status
      relationship: bshRaw.relationship,
    }
  }
  
  // RW 直接返回
  const rwRaw = raw as RWMerchantRaw
  return {
    mcid: rwRaw.mcid,
    mid: rwRaw.mid,
    merchant_name: rwRaw.merchant_name,
    site_url: rwRaw.site_url,
    tracking_url: rwRaw.tracking_url,
    merchant_status: rwRaw.merchant_status,
    relationship: rwRaw.relationship,
  }
}

/**
 * 带重试的请求函数
 * @param maxRetries 最大重试次数
 * @param retryDelay 重试间隔（毫秒）
 */
async function fetchMerchantPageWithRetry(
  config: AffiliateApiConfig,
  token: string,
  page: number,
  pageSize: number,
  maxRetries: number = 3,
  retryDelay: number = 2000
): Promise<NormalizedPageResponse> {
  let lastError: Error | null = null
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const result = await fetchMerchantPage(config, token, page, pageSize)
      return result
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))
      console.log(`[affiliate-sync] 第 ${page} 页请求失败 (尝试 ${attempt}/${maxRetries}): ${lastError.message}`)
      
      if (attempt < maxRetries) {
        // 指数退避：每次重试延迟加倍
        const delay = retryDelay * attempt
        console.log(`[affiliate-sync] 等待 ${delay}ms 后重试...`)
        await new Promise(resolve => setTimeout(resolve, delay))
      }
    }
  }
  
  // 所有重试都失败，返回错误但不抛出异常（允许其他页面继续）
  console.log(`[affiliate-sync] 第 ${page} 页最终失败: ${lastError?.message}`)
  return {
    success: false,
    errorMsg: lastError?.message || '请求失败',
    totalPage: 0,
    totalCount: 0,
    merchants: [],
  }
}

/**
 * 格式化 SSE 消息
 */
function formatSSE(data: SyncProgress): string {
  return `data: ${JSON.stringify(data)}\n\n`
}

// ============================================
// 同步逻辑（生成器函数）
// ============================================

async function* syncAffiliateData(
  userId: string,
  networkShortName: string,
  affiliateApiKey: string,
  apiConfig: AffiliateApiConfig
): AsyncGenerator<SyncProgress> {
  // ========== 阶段 1: 初始化 ==========
  console.log('[affiliate-sync] 阶段1: 初始化, 联盟类型:', apiConfig.type)
  yield {
    stage: 'init',
    current: 0,
    total: 0,
    message: '正在初始化...',
    networkName: networkShortName,
  }

  // 查找或创建联盟网络记录
  console.log('[affiliate-sync] 查询/创建联盟网络记录')
  let network = await prisma.affiliateNetwork.findFirst({
    where: {
      userId,
      shortName: networkShortName.toUpperCase(),
      deletedAt: null,
    },
  })

  if (!network) {
    console.log('[affiliate-sync] 创建新联盟网络:', networkShortName)
    network = await prisma.affiliateNetwork.create({
      data: {
        userId,
        name: networkShortName,
        shortName: networkShortName.toUpperCase(),
        apiKey: affiliateApiKey,
        status: 'active',
      },
    })
  } else {
    console.log('[affiliate-sync] 更新联盟网络 API Key')
    await prisma.affiliateNetwork.update({
      where: { id: network.id },
      data: { apiKey: affiliateApiKey },
    })
  }

  // ========== 阶段 2: 获取数据 ==========
  console.log('[affiliate-sync] 阶段2: 获取数据')
  yield {
    stage: 'fetching',
    current: 0,
    total: 0,
    message: '正在获取第 1 页数据...',
    networkName: networkShortName,
  }

  // 获取第一页
  console.log('[affiliate-sync] 获取第 1 页...')
  const firstPage = await fetchMerchantPage(apiConfig, affiliateApiKey, 1, PAGE_SIZE)

  if (!firstPage.success) {
    throw new Error(`联盟 API 错误: ${firstPage.errorMsg}`)
  }

  const totalPages = firstPage.totalPage
  const totalMerchants = firstPage.totalCount
  const allMerchants: NormalizedMerchant[] = [...firstPage.merchants]

  console.log('[affiliate-sync] 第 1 页完成, 总页数:', totalPages, '总商家:', totalMerchants)
  yield {
    stage: 'fetching',
    current: 1,
    total: totalPages,
    message: `获取中: 1/${totalPages} 页，共 ${totalMerchants} 个商家`,
    networkName: networkShortName,
  }

  // 输出样例数据（用于人工核对 mid/mcid/id 等字段）
  yield {
    stage: 'fetching',
    current: 1,
    total: totalPages,
    message: '样例数据已输出（raw + normalized）',
    networkName: networkShortName,
    debug: {
      rawResponsePreview: firstPage.rawResponsePreview,
      rawMerchantSample: firstPage.rawMerchantSample,
      normalizedSample: firstPage.normalizedSample,
    },
  }

  // 并发获取剩余页面（使用配置的并发数）
  if (totalPages > 1) {
    const remainingPages = Array.from({ length: totalPages - 1 }, (_, i) => i + 2)
    const concurrency = apiConfig.concurrency || CONCURRENCY
    const requestDelay = apiConfig.requestDelay || 0

    for (let i = 0; i < remainingPages.length; i += concurrency) {
      const batch = remainingPages.slice(i, i + concurrency)
      console.log(`[affiliate-sync] 获取页面批次: ${batch.join(',')} (并发: ${concurrency})`)
      
      // 带重试的请求
      const results = await Promise.all(
        batch.map(page => fetchMerchantPageWithRetry(apiConfig, affiliateApiKey, page, PAGE_SIZE))
      )

      results.forEach(r => {
        if (r.success && r.merchants) {
          allMerchants.push(...r.merchants)
        }
      })
      
      // 请求延迟（避免触发限流）
      if (requestDelay > 0 && i + concurrency < remainingPages.length) {
        await new Promise(resolve => setTimeout(resolve, requestDelay))
      }

      const completedPages = Math.min(i + CONCURRENCY, remainingPages.length) + 1
      yield {
        stage: 'fetching',
        current: completedPages,
        total: totalPages,
        message: `获取中: ${completedPages}/${totalPages} 页`,
        networkName: networkShortName,
      }
    }
  }

  // ========== 阶段 3: 保存数据 ==========
  console.log('[affiliate-sync] 阶段3: 保存数据, 商家数:', allMerchants.length)
  yield {
    stage: 'saving',
    current: 0,
    total: allMerchants.length,
    message: `正在保存 ${allMerchants.length} 个商家数据...`,
    networkName: networkShortName,
  }

  const BATCH_SIZE = 100
  let savedCount = 0

  for (let i = 0; i < allMerchants.length; i += BATCH_SIZE) {
    const batch = allMerchants.slice(i, i + BATCH_SIZE)

    await Promise.all(
      batch.map(async merchant => {
        const domain = extractDomain(merchant.site_url)
        // trackingUrl 在 schema 中是必填字段，如果为 null 则使用空字符串
        const trackingUrl = merchant.tracking_url || ''
        
        await prisma.affiliateMerchant.upsert({
          where: {
            userId_networkId_mcid: {
              userId,
              networkId: network.id,
              mcid: merchant.mcid,
            },
          },
          create: {
            // 使用 connect 关联已存在的 user 和 network
            user: { connect: { id: userId } },
            network: { connect: { id: network.id } },
            mcid: merchant.mcid,
            mid: merchant.mid,
            merchantName: merchant.merchant_name,
            siteUrl: merchant.site_url,
            domain,
            trackingUrl,
            merchantStatus: merchant.merchant_status,
            relationship: merchant.relationship || undefined,
            lastSyncedAt: new Date(),
          },
          update: {
            mcid: merchant.mcid,
            mid: merchant.mid,
            merchantName: merchant.merchant_name,
            siteUrl: merchant.site_url,
            domain,
            trackingUrl,
            merchantStatus: merchant.merchant_status,
            relationship: merchant.relationship || undefined,
            lastSyncedAt: new Date(),
            deletedAt: null,
          },
        })
      })
    )

    savedCount += batch.length
    yield {
      stage: 'saving',
      current: savedCount,
      total: allMerchants.length,
      message: `保存中: ${savedCount}/${allMerchants.length}`,
      networkName: networkShortName,
    }
  }

  // ========== 阶段 4: 完成 ==========
  console.log('[affiliate-sync] 阶段4: 完成')
  yield {
    stage: 'done',
    current: allMerchants.length,
    total: allMerchants.length,
    message: `同步完成！共 ${allMerchants.length} 个商家`,
    networkName: networkShortName,
  }
}

// ============================================
// API Handler
// ============================================

export async function POST(req: NextRequest) {
  // 1. 鉴权
  const authResult = await authenticateRequest(req)
  if (!authResult.success || !authResult.userId) {
    return new Response(JSON.stringify({ error: authResult.error?.message || '鉴权失败' }), {
      status: authResult.error?.status || 401,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const userId = authResult.userId

  // 2. 解析请求参数
  let body: { networkShortName: string; apiKey: string }
  try {
    body = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: '无效的请求体' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const { networkShortName, apiKey: affiliateApiKey } = body
  
  console.log('[affiliate-sync] 收到同步请求:', { networkShortName, hasApiKey: !!affiliateApiKey })
  
  if (!networkShortName || !affiliateApiKey) {
    return new Response(JSON.stringify({ error: '缺少联盟简称或 API Key' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // 3. 获取联盟 API 配置（支持前缀匹配）
  const supportedNetworks = Object.keys(AFFILIATE_API_CONFIG)
  const upperName = networkShortName.toUpperCase()
  const matchedNetwork = supportedNetworks.find(prefix => upperName.startsWith(prefix))
  const apiConfig = matchedNetwork ? AFFILIATE_API_CONFIG[matchedNetwork] : null
  
  if (!apiConfig || !matchedNetwork) {
    return new Response(JSON.stringify({ 
      error: `不支持的联盟: ${networkShortName}，联盟简称需以以下前缀开头: ${supportedNetworks.join(', ')}` 
    }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }
  
  console.log('[affiliate-sync] 开始同步:', networkShortName, '-> 联盟类型:', matchedNetwork)

  // 4. 创建 SSE 流响应
  const encoder = new TextEncoder()
  
  const stream = new ReadableStream({
    async start(controller) {
      try {
        // 使用生成器执行同步逻辑
        const generator = syncAffiliateData(userId, networkShortName, affiliateApiKey, apiConfig)
        
        for await (const progress of generator) {
          const data = formatSSE(progress)
          controller.enqueue(encoder.encode(data))
        }
      } catch (error) {
        console.error('[affiliate-sync] 错误:', error)
        const errorProgress: SyncProgress = {
          stage: 'error',
          current: 0,
          total: 0,
          message: error instanceof Error ? error.message : '同步失败',
          networkName: networkShortName,
        }
        controller.enqueue(encoder.encode(formatSSE(errorProgress)))
      } finally {
        console.log('[affiliate-sync] 流关闭')
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no', // 禁用 Nginx 缓冲
    },
  })
}
