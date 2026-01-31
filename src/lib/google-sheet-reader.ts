/**
 * Google Sheet CSV 读取工具
 * 
 * 功能：
 * - 从 Spreadsheet URL 提取 spreadsheetId 和 gid
 * - 读取公开表格的 CSV 数据
 * - 解析 CSV 为对象数组
 * 
 * 前提条件：
 * - 表格需设置为「知道链接的任何人可查看」
 */

// ================= URL 解析 =================

export interface SpreadsheetUrlInfo {
  spreadsheetId: string
  gid: string
}

/**
 * 从 Google Spreadsheet URL 提取 spreadsheetId 和 gid
 * 
 * 支持格式：
 * - https://docs.google.com/spreadsheets/d/{spreadsheetId}/edit#gid={gid}
 * - https://docs.google.com/spreadsheets/d/{spreadsheetId}/edit?gid={gid}
 * - https://docs.google.com/spreadsheets/d/{spreadsheetId}/
 * 
 * @param url Spreadsheet URL
 * @returns 解析结果，失败返回 null
 */
export function parseSpreadsheetUrl(url: string): SpreadsheetUrlInfo | null {
  try {
    const urlObj = new URL(url)
    
    // 检查是否是 Google Spreadsheet 链接
    if (!urlObj.hostname.includes('docs.google.com')) {
      return null
    }
    
    // 提取 spreadsheetId：/d/{spreadsheetId}/
    const pathMatch = urlObj.pathname.match(/\/d\/([a-zA-Z0-9_-]+)/)
    if (!pathMatch) {
      return null
    }
    const spreadsheetId = pathMatch[1]
    
    // 提取 gid：优先从 hash 获取，其次从 query 获取
    let gid = '0' // 默认第一个工作表
    
    // 尝试从 hash 获取：#gid=xxx
    const hashMatch = urlObj.hash.match(/gid=(\d+)/)
    if (hashMatch) {
      gid = hashMatch[1]
    } else {
      // 尝试从 query 获取：?gid=xxx
      const gidParam = urlObj.searchParams.get('gid')
      if (gidParam) {
        gid = gidParam
      }
    }
    
    return { spreadsheetId, gid }
  } catch {
    return null
  }
}

/**
 * 构建 CSV 导出 URL
 */
export function buildCsvExportUrl(info: SpreadsheetUrlInfo): string {
  return `https://docs.google.com/spreadsheets/d/${info.spreadsheetId}/export?format=csv&gid=${info.gid}`
}

// ================= CSV 读取与解析 =================

export interface CsvParseResult<T = Record<string, string>> {
  success: boolean
  data: T[]
  headers: string[]
  rowCount: number
  error?: string
}

/**
 * 解析 CSV 文本为对象数组
 * 
 * 支持：
 * - Windows/Unix/Mac 换行符
 * - 引号内的换行符（多行单元格）
 * - 引号转义（双引号）
 * 
 * @param csvText CSV 文本内容
 * @returns 解析结果
 */
export function parseCsv<T = Record<string, string>>(csvText: string): CsvParseResult<T> {
  try {
    // 解析所有行（正确处理引号内的换行符）
    const rows = parseCSVRows(csvText)
    
    if (rows.length < 1) {
      return { success: false, data: [], headers: [], rowCount: 0, error: '表格为空' }
    }
    
    // 第一行为表头
    const headers = rows[0]
    
    if (headers.length === 0) {
      return { success: false, data: [], headers: [], rowCount: 0, error: '表头为空' }
    }
    
    // 解析数据行
    const data: T[] = []
    for (let i = 1; i < rows.length; i++) {
      const values = rows[i]
      
      // 跳过空行（所有字段都为空）
      if (values.every(v => !v.trim())) continue
      
      const row: Record<string, string> = {}
      for (let j = 0; j < headers.length; j++) {
        row[headers[j]] = values[j] || ''
      }
      
      data.push(row as T)
    }
    
    return {
      success: true,
      data,
      headers,
      rowCount: data.length,
    }
  } catch (error) {
    return {
      success: false,
      data: [],
      headers: [],
      rowCount: 0,
      error: error instanceof Error ? error.message : 'CSV 解析失败',
    }
  }
}

/**
 * 解析 CSV 文本为二维数组（正确处理引号内的换行符）
 */
function parseCSVRows(csvText: string): string[][] {
  const rows: string[][] = []
  let currentRow: string[] = []
  let currentField = ''
  let inQuotes = false
  
  // 统一换行符为 \n
  const text = csvText.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  
  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    const nextChar = text[i + 1]
    
    if (inQuotes) {
      if (char === '"') {
        if (nextChar === '"') {
          // 双引号转义：""  -> "
          currentField += '"'
          i++ // 跳过下一个引号
        } else {
          // 引号结束
          inQuotes = false
        }
      } else {
        // 引号内的任何字符（包括换行符）都保留
        currentField += char
      }
    } else {
      if (char === '"') {
        // 引号开始
        inQuotes = true
      } else if (char === ',') {
        // 字段分隔符
        currentRow.push(currentField.trim())
        currentField = ''
      } else if (char === '\n') {
        // 行分隔符
        currentRow.push(currentField.trim())
        rows.push(currentRow)
        currentRow = []
        currentField = ''
      } else {
        currentField += char
      }
    }
  }
  
  // 处理最后一个字段和最后一行
  if (currentField || currentRow.length > 0) {
    currentRow.push(currentField.trim())
    rows.push(currentRow)
  }
  
  return rows
}

// ================= 远程读取 =================

export interface FetchSheetResult<T = Record<string, string>> {
  success: boolean
  data: T[]
  headers: string[]
  rowCount: number
  spreadsheetId: string
  gid: string
  error?: string
}

/**
 * 从 Google Spreadsheet URL 读取数据
 * 
 * @param url Spreadsheet URL
 * @param timeout 超时时间（毫秒），默认 30 秒
 * @returns 读取结果
 */
export async function fetchSheetData<T = Record<string, string>>(
  url: string,
  timeout: number = 30000
): Promise<FetchSheetResult<T>> {
  // 解析 URL
  const urlInfo = parseSpreadsheetUrl(url)
  if (!urlInfo) {
    return {
      success: false,
      data: [],
      headers: [],
      rowCount: 0,
      spreadsheetId: '',
      gid: '',
      error: '无效的 Spreadsheet URL',
    }
  }
  
  const csvUrl = buildCsvExportUrl(urlInfo)
  
  try {
    // 使用 AbortController 实现超时
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), timeout)
    
    const response = await fetch(csvUrl, {
      signal: controller.signal,
      headers: {
        'Accept': 'text/csv',
      },
    })
    
    clearTimeout(timeoutId)
    
    if (!response.ok) {
      // 常见错误处理
      if (response.status === 404) {
        return {
          success: false,
          data: [],
          headers: [],
          rowCount: 0,
          spreadsheetId: urlInfo.spreadsheetId,
          gid: urlInfo.gid,
          error: '表格不存在或链接无效',
        }
      }
      if (response.status === 403) {
        return {
          success: false,
          data: [],
          headers: [],
          rowCount: 0,
          spreadsheetId: urlInfo.spreadsheetId,
          gid: urlInfo.gid,
          error: '表格未公开，请设置为「知道链接的任何人可查看」',
        }
      }
      return {
        success: false,
        data: [],
        headers: [],
        rowCount: 0,
        spreadsheetId: urlInfo.spreadsheetId,
        gid: urlInfo.gid,
        error: `请求失败: HTTP ${response.status}`,
      }
    }
    
    const csvText = await response.text()
    const parseResult = parseCsv<T>(csvText)
    
    return {
      ...parseResult,
      spreadsheetId: urlInfo.spreadsheetId,
      gid: urlInfo.gid,
    }
  } catch (error) {
    // 超时或网络错误
    if (error instanceof Error && error.name === 'AbortError') {
      return {
        success: false,
        data: [],
        headers: [],
        rowCount: 0,
        spreadsheetId: urlInfo.spreadsheetId,
        gid: urlInfo.gid,
        error: '请求超时，请检查网络或表格权限',
      }
    }
    
    return {
      success: false,
      data: [],
      headers: [],
      rowCount: 0,
      spreadsheetId: urlInfo.spreadsheetId,
      gid: urlInfo.gid,
      error: error instanceof Error ? error.message : '网络请求失败',
    }
  }
}

// ================= 广告系列数据类型 =================

/**
 * 表格中的广告系列数据结构（对应 campaign_sync_to_sheet.js 输出）
 */
export interface SheetCampaignRow {
  campaignId: string
  campaignName: string
  country: string
  finalUrl: string
  todayClicks: string
  cid: string
  mccId: string
  updatedAt: string
  trackingUrl?: string  // 联盟追踪链接（可选）
}

/**
 * 验证表格数据是否包含必要字段
 */
export function validateCampaignHeaders(headers: string[]): { valid: boolean; missing: string[] } {
  const requiredFields = ['campaignId', 'cid', 'mccId']
  const missing = requiredFields.filter(field => !headers.includes(field))
  return {
    valid: missing.length === 0,
    missing,
  }
}

// ================= 域名提取 =================

/**
 * 常见的二级顶级域名（Second-Level TLDs）
 * 这些域名需要保留两级后缀
 */
const SECOND_LEVEL_TLDS = new Set([
  // 英国
  'co.uk', 'org.uk', 'me.uk', 'ac.uk', 'gov.uk', 'ltd.uk', 'plc.uk', 'net.uk', 'sch.uk',
  // 澳大利亚
  'com.au', 'net.au', 'org.au', 'edu.au', 'gov.au', 'asn.au', 'id.au',
  // 新西兰
  'co.nz', 'net.nz', 'org.nz', 'govt.nz', 'ac.nz', 'school.nz', 'geek.nz', 'gen.nz',
  // 日本
  'co.jp', 'or.jp', 'ne.jp', 'ac.jp', 'ad.jp', 'ed.jp', 'go.jp', 'gr.jp', 'lg.jp',
  // 中国
  'com.cn', 'net.cn', 'org.cn', 'gov.cn', 'edu.cn', 'ac.cn', 'mil.cn',
  // 香港
  'com.hk', 'org.hk', 'net.hk', 'edu.hk', 'gov.hk', 'idv.hk',
  // 台湾
  'com.tw', 'org.tw', 'net.tw', 'edu.tw', 'gov.tw', 'idv.tw',
  // 韩国
  'co.kr', 'or.kr', 'ne.kr', 're.kr', 'pe.kr', 'go.kr', 'mil.kr', 'ac.kr', 'hs.kr', 'ms.kr', 'es.kr', 'sc.kr', 'kg.kr',
  // 印度
  'co.in', 'firm.in', 'net.in', 'org.in', 'gen.in', 'ind.in', 'nic.in', 'ac.in', 'edu.in', 'res.in', 'gov.in', 'mil.in',
  // 巴西
  'com.br', 'net.br', 'org.br', 'gov.br', 'edu.br', 'mil.br', 'art.br', 'blog.br', 'wiki.br',
  // 南非
  'co.za', 'org.za', 'net.za', 'gov.za', 'edu.za', 'ac.za', 'web.za',
  // 新加坡
  'com.sg', 'net.sg', 'org.sg', 'gov.sg', 'edu.sg', 'per.sg',
  // 马来西亚
  'com.my', 'net.my', 'org.my', 'gov.my', 'edu.my', 'mil.my', 'name.my',
  // 印度尼西亚
  'co.id', 'or.id', 'web.id', 'sch.id', 'mil.id', 'go.id', 'ac.id', 'net.id',
  // 泰国
  'co.th', 'in.th', 'ac.th', 'go.th', 'mi.th', 'or.th', 'net.th',
  // 越南
  'com.vn', 'net.vn', 'org.vn', 'edu.vn', 'gov.vn', 'int.vn', 'ac.vn', 'biz.vn', 'info.vn', 'name.vn', 'pro.vn', 'health.vn',
  // 菲律宾
  'com.ph', 'net.ph', 'org.ph', 'gov.ph', 'edu.ph', 'ngo.ph', 'mil.ph',
  // 以色列
  'co.il', 'org.il', 'net.il', 'ac.il', 'gov.il', 'muni.il', 'idf.il',
  // 土耳其
  'com.tr', 'net.tr', 'org.tr', 'biz.tr', 'info.tr', 'tv.tr', 'gen.tr', 'web.tr', 'av.tr', 'dr.tr', 'bbs.tr', 'name.tr', 'tel.tr', 'gov.tr', 'bel.tr', 'pol.tr', 'mil.tr', 'k12.tr', 'edu.tr', 'nc.tr',
  // 墨西哥
  'com.mx', 'net.mx', 'org.mx', 'edu.mx', 'gob.mx',
  // 阿根廷
  'com.ar', 'net.ar', 'org.ar', 'gov.ar', 'edu.ar', 'int.ar', 'mil.ar',
  // 俄罗斯
  'com.ru', 'net.ru', 'org.ru', 'pp.ru',
  // 乌克兰
  'com.ua', 'net.ua', 'org.ua', 'edu.ua', 'gov.ua',
  // 波兰
  'com.pl', 'net.pl', 'org.pl', 'edu.pl', 'gov.pl', 'info.pl', 'biz.pl',
  // 西班牙
  'com.es', 'nom.es', 'org.es', 'gob.es', 'edu.es',
  // 意大利
  'co.it',
  // 法国
  'asso.fr', 'nom.fr', 'prd.fr', 'com.fr',
  // 德国
  'co.de',
  // 荷兰
  'co.nl',
  // 比利时
  'co.be',
  // 瑞士
  'co.ch',
  // 奥地利
  'co.at', 'or.at',
  // 埃及
  'com.eg', 'edu.eg', 'eun.eg', 'gov.eg', 'mil.eg', 'net.eg', 'org.eg', 'sci.eg',
  // 沙特
  'com.sa', 'net.sa', 'org.sa', 'gov.sa', 'med.sa', 'pub.sa', 'edu.sa', 'sch.sa',
  // 阿联酋
  'co.ae', 'net.ae', 'org.ae', 'sch.ae', 'ac.ae', 'gov.ae', 'mil.ae',
  // 巴基斯坦
  'com.pk', 'net.pk', 'edu.pk', 'org.pk', 'fam.pk', 'biz.pk', 'web.pk', 'gov.pk', 'gob.pk', 'gok.pk', 'gon.pk', 'gop.pk', 'gos.pk',
  // 孟加拉
  'com.bd', 'edu.bd', 'net.bd', 'gov.bd', 'org.bd', 'mil.bd',
  // 尼日利亚
  'com.ng', 'edu.ng', 'gov.ng', 'net.ng', 'org.ng',
  // 肯尼亚
  'co.ke', 'or.ke', 'ne.ke', 'go.ke', 'ac.ke', 'sc.ke',
  // 其他常见
  'com.co', 'net.co', 'nom.co', 'gov.co', 'edu.co', 'org.co', 'mil.co',
  'com.pe', 'net.pe', 'org.pe', 'edu.pe', 'gob.pe', 'nom.pe', 'mil.pe',
  'com.ve', 'net.ve', 'org.ve', 'edu.ve', 'gob.ve', 'mil.ve', 'co.ve',
  'com.ec', 'net.ec', 'org.ec', 'edu.ec', 'gov.ec', 'mil.ec', 'fin.ec', 'med.ec',
  'com.uy', 'edu.uy', 'gub.uy', 'net.uy', 'mil.uy', 'org.uy',
  'com.py', 'edu.py', 'gov.py', 'mil.py', 'net.py', 'org.py',
  'com.bo', 'edu.bo', 'gob.bo', 'int.bo', 'org.bo', 'net.bo', 'mil.bo', 'tv.bo',
])

/**
 * 从 URL 提取最短根域名
 * 
 * 示例：
 * - https://www.twojemeble.pl/path -> twojemeble.pl
 * - https://shop.blindsdirect.co.uk/path -> blindsdirect.co.uk
 * - https://www.colipays.com/path -> colipays.com
 * - https://sub.domain.example.com -> example.com
 * 
 * @param url URL 或域名字符串
 * @returns 最短根域名
 */
export function extractRootDomain(url: string | null | undefined): string {
  if (!url) return ''
  
  let hostname = url.trim()
  
  // 如果是完整 URL，提取 hostname
  try {
    if (hostname.includes('://')) {
      const urlObj = new URL(hostname)
      hostname = urlObj.hostname
    } else if (hostname.includes('/')) {
      // 可能是 domain.com/path 格式
      hostname = hostname.split('/')[0]
    }
  } catch {
    // URL 解析失败，尝试直接处理
    if (hostname.includes('/')) {
      hostname = hostname.split('/')[0]
    }
  }
  
  // 去掉端口号
  hostname = hostname.split(':')[0]
  
  // 转小写并去除首尾空白
  hostname = hostname.toLowerCase().trim()
  
  // 如果为空或不包含点，直接返回
  if (!hostname || !hostname.includes('.')) {
    return hostname
  }
  
  // 分割域名
  const parts = hostname.split('.')
  
  // 去掉 www 前缀
  if (parts[0] === 'www') {
    parts.shift()
  }
  
  // 如果只剩两部分，直接返回（如 example.com）
  if (parts.length <= 2) {
    return parts.join('.')
  }
  
  // 检查是否是二级顶级域名
  const lastTwo = parts.slice(-2).join('.')
  if (SECOND_LEVEL_TLDS.has(lastTwo)) {
    // 需要保留三部分（如 example.co.uk）
    return parts.slice(-3).join('.')
  }
  
  // 普通域名，保留最后两部分
  return parts.slice(-2).join('.')
}

// ================= 国家代码转换 =================

/**
 * Google Ads geoTargetConstants ID 到国家代码的映射
 * 数据来源: https://developers.google.com/google-ads/api/data/geotargets
 */
const GEO_TARGET_TO_COUNTRY: Record<string, string> = {
  // 主要国家
  '2840': 'US',  // United States
  '2826': 'GB',  // United Kingdom
  '2036': 'AU',  // Australia
  '2124': 'CA',  // Canada
  '2276': 'DE',  // Germany
  '2250': 'FR',  // France
  '2392': 'JP',  // Japan
  '2156': 'CN',  // China
  '2356': 'IN',  // India
  '2076': 'BR',  // Brazil
  '2484': 'MX',  // Mexico
  '2410': 'KR',  // South Korea
  '2380': 'IT',  // Italy
  '2724': 'ES',  // Spain
  '2528': 'NL',  // Netherlands
  '2643': 'RU',  // Russia
  '2702': 'SG',  // Singapore
  '2344': 'HK',  // Hong Kong
  '2158': 'TW',  // Taiwan
  '2608': 'PH',  // Philippines
  '2360': 'ID',  // Indonesia
  '2764': 'TH',  // Thailand
  '2704': 'VN',  // Vietnam
  '2458': 'MY',  // Malaysia
  '2554': 'NZ',  // New Zealand
  '2056': 'BE',  // Belgium
  '2756': 'CH',  // Switzerland
  '2040': 'AT',  // Austria
  '2616': 'PL',  // Poland
  '2752': 'SE',  // Sweden
  '2578': 'NO',  // Norway
  '2208': 'DK',  // Denmark
  '2246': 'FI',  // Finland
  '2372': 'IE',  // Ireland
  '2620': 'PT',  // Portugal
  '2300': 'GR',  // Greece
  '2792': 'TR',  // Turkey
  '2682': 'SA',  // Saudi Arabia
  '2784': 'AE',  // United Arab Emirates
  '2818': 'EG',  // Egypt
  '2710': 'ZA',  // South Africa
  '2376': 'IL',  // Israel
  '2032': 'AR',  // Argentina
  '2152': 'CL',  // Chile
  '2170': 'CO',  // Colombia
  '2604': 'PE',  // Peru
}

/**
 * 国家全名到代码的映射（不区分大小写）
 * 包含 200+ 国家/地区
 */
const COUNTRY_NAME_TO_CODE: Record<string, string> = {
  // 北美洲
  'united states': 'US',
  'united states of america': 'US',
  'usa': 'US',
  'canada': 'CA',
  'mexico': 'MX',
  
  // 欧洲
  'united kingdom': 'GB',
  'great britain': 'GB',
  'uk': 'GB',
  'england': 'GB',
  'germany': 'DE',
  'france': 'FR',
  'italy': 'IT',
  'spain': 'ES',
  'netherlands': 'NL',
  'holland': 'NL',
  'belgium': 'BE',
  'switzerland': 'CH',
  'austria': 'AT',
  'poland': 'PL',
  'sweden': 'SE',
  'norway': 'NO',
  'denmark': 'DK',
  'finland': 'FI',
  'ireland': 'IE',
  'portugal': 'PT',
  'greece': 'GR',
  'czech republic': 'CZ',
  'czechia': 'CZ',
  'romania': 'RO',
  'hungary': 'HU',
  'ukraine': 'UA',
  'russia': 'RU',
  'russian federation': 'RU',
  'turkey': 'TR',
  'croatia': 'HR',
  'slovakia': 'SK',
  'slovenia': 'SI',
  'bulgaria': 'BG',
  'serbia': 'RS',
  'lithuania': 'LT',
  'latvia': 'LV',
  'estonia': 'EE',
  'luxembourg': 'LU',
  'malta': 'MT',
  'cyprus': 'CY',
  'iceland': 'IS',
  'albania': 'AL',
  'north macedonia': 'MK',
  'macedonia': 'MK',
  'bosnia and herzegovina': 'BA',
  'montenegro': 'ME',
  'moldova': 'MD',
  'belarus': 'BY',
  'monaco': 'MC',
  'liechtenstein': 'LI',
  'san marino': 'SM',
  'andorra': 'AD',
  
  // 亚洲
  'japan': 'JP',
  'china': 'CN',
  "people's republic of china": 'CN',
  'south korea': 'KR',
  'korea': 'KR',
  'republic of korea': 'KR',
  'north korea': 'KP',
  'india': 'IN',
  'indonesia': 'ID',
  'thailand': 'TH',
  'vietnam': 'VN',
  'viet nam': 'VN',
  'malaysia': 'MY',
  'singapore': 'SG',
  'philippines': 'PH',
  'hong kong': 'HK',
  'taiwan': 'TW',
  'pakistan': 'PK',
  'bangladesh': 'BD',
  'sri lanka': 'LK',
  'myanmar': 'MM',
  'burma': 'MM',
  'cambodia': 'KH',
  'laos': 'LA',
  'nepal': 'NP',
  'mongolia': 'MN',
  'kazakhstan': 'KZ',
  'uzbekistan': 'UZ',
  'turkmenistan': 'TM',
  'kyrgyzstan': 'KG',
  'tajikistan': 'TJ',
  'afghanistan': 'AF',
  'maldives': 'MV',
  'brunei': 'BN',
  'macau': 'MO',
  'macao': 'MO',
  'timor-leste': 'TL',
  'east timor': 'TL',
  
  // 中东
  'saudi arabia': 'SA',
  'united arab emirates': 'AE',
  'uae': 'AE',
  'israel': 'IL',
  'iran': 'IR',
  'iraq': 'IQ',
  'kuwait': 'KW',
  'qatar': 'QA',
  'bahrain': 'BH',
  'oman': 'OM',
  'jordan': 'JO',
  'lebanon': 'LB',
  'syria': 'SY',
  'yemen': 'YE',
  'palestine': 'PS',
  
  // 非洲
  'egypt': 'EG',
  'south africa': 'ZA',
  'nigeria': 'NG',
  'kenya': 'KE',
  'morocco': 'MA',
  'algeria': 'DZ',
  'tunisia': 'TN',
  'libya': 'LY',
  'ethiopia': 'ET',
  'ghana': 'GH',
  'tanzania': 'TZ',
  'uganda': 'UG',
  'sudan': 'SD',
  'south sudan': 'SS',
  'angola': 'AO',
  'mozambique': 'MZ',
  'zambia': 'ZM',
  'zimbabwe': 'ZW',
  'botswana': 'BW',
  'namibia': 'NA',
  'senegal': 'SN',
  'ivory coast': 'CI',
  "côte d'ivoire": 'CI',
  'cameroon': 'CM',
  'democratic republic of the congo': 'CD',
  'congo': 'CG',
  'rwanda': 'RW',
  'mauritius': 'MU',
  'madagascar': 'MG',
  'mali': 'ML',
  'burkina faso': 'BF',
  'niger': 'NE',
  'benin': 'BJ',
  'togo': 'TG',
  'sierra leone': 'SL',
  'liberia': 'LR',
  'guinea': 'GN',
  'gambia': 'GM',
  'gabon': 'GA',
  'equatorial guinea': 'GQ',
  'mauritania': 'MR',
  'eritrea': 'ER',
  'djibouti': 'DJ',
  'somalia': 'SO',
  'malawi': 'MW',
  'lesotho': 'LS',
  'eswatini': 'SZ',
  'swaziland': 'SZ',
  'comoros': 'KM',
  'seychelles': 'SC',
  'cabo verde': 'CV',
  'cape verde': 'CV',
  
  // 大洋洲
  'australia': 'AU',
  'new zealand': 'NZ',
  'fiji': 'FJ',
  'papua new guinea': 'PG',
  'samoa': 'WS',
  'tonga': 'TO',
  'vanuatu': 'VU',
  'solomon islands': 'SB',
  'micronesia': 'FM',
  'palau': 'PW',
  'marshall islands': 'MH',
  'kiribati': 'KI',
  'nauru': 'NR',
  'tuvalu': 'TV',
  'guam': 'GU',
  'new caledonia': 'NC',
  'french polynesia': 'PF',
  
  // 南美洲
  'brazil': 'BR',
  'argentina': 'AR',
  'chile': 'CL',
  'colombia': 'CO',
  'peru': 'PE',
  'venezuela': 'VE',
  'ecuador': 'EC',
  'bolivia': 'BO',
  'paraguay': 'PY',
  'uruguay': 'UY',
  'guyana': 'GY',
  'suriname': 'SR',
  'french guiana': 'GF',
  
  // 中美洲和加勒比
  'guatemala': 'GT',
  'honduras': 'HN',
  'el salvador': 'SV',
  'nicaragua': 'NI',
  'costa rica': 'CR',
  'panama': 'PA',
  'belize': 'BZ',
  'cuba': 'CU',
  'jamaica': 'JM',
  'haiti': 'HT',
  'dominican republic': 'DO',
  'puerto rico': 'PR',
  'trinidad and tobago': 'TT',
  'bahamas': 'BS',
  'barbados': 'BB',
  'saint lucia': 'LC',
  'grenada': 'GD',
  'saint vincent and the grenadines': 'VC',
  'antigua and barbuda': 'AG',
  'dominica': 'DM',
  'saint kitts and nevis': 'KN',
  'aruba': 'AW',
  'curacao': 'CW',
  'cayman islands': 'KY',
  'bermuda': 'BM',
  'virgin islands': 'VI',
  'martinique': 'MQ',
  'guadeloupe': 'GP',
}

/**
 * 将地理位置字符串转换为国家代码
 * 
 * 支持输入格式：
 * - "United States" (国家全名)
 * - "geoTargetConstants/2840" (Google Ads 格式)
 * - "geoTargetConstants/2840; geoTargetConstants/2826" (多个)
 * - "US" (已经是国家代码，直接返回)
 * 
 * @param geoString 原始地理位置字符串
 * @returns 国家代码（多个用逗号分隔）
 */
export function convertGeoToCountryCode(geoString: string | null | undefined): string {
  if (!geoString) return ''
  
  const trimmed = geoString.trim()
  
  // 如果已经是短格式（2-3个字母），直接返回
  if (/^[A-Z]{2,3}$/i.test(trimmed)) {
    return trimmed.toUpperCase()
  }
  
  // 如果是逗号分隔的短格式列表
  if (/^[A-Z]{2,3}(,\s*[A-Z]{2,3})*$/i.test(trimmed)) {
    return trimmed.toUpperCase()
  }
  
  // 尝试匹配国家全名
  const lowerTrimmed = trimmed.toLowerCase()
  if (COUNTRY_NAME_TO_CODE[lowerTrimmed]) {
    return COUNTRY_NAME_TO_CODE[lowerTrimmed]
  }
  
  // 解析 geoTargetConstants 格式
  const geoPattern = /geoTargetConstants\/(\d+)/g
  const matches = [...trimmed.matchAll(geoPattern)]
  
  if (matches.length > 0) {
    // 转换每个 geoTargetConstants ID
    const countryCodes: string[] = []
    for (const match of matches) {
      const geoId = match[1]
      const countryCode = GEO_TARGET_TO_COUNTRY[geoId]
      if (countryCode && !countryCodes.includes(countryCode)) {
        countryCodes.push(countryCode)
      }
    }
    
    if (countryCodes.length > 0) {
      return countryCodes.join(',')
    }
    
    // 如果没有找到映射，返回原始ID（截取）
    const ids = matches.map(m => m[1]).join(',')
    return ids.length > 20 ? ids.substring(0, 20) : ids
  }
  
  // 尝试分号分隔的多个国家名
  if (trimmed.includes(';')) {
    const parts = trimmed.split(';').map(p => p.trim())
    const codes: string[] = []
    for (const part of parts) {
      const code = COUNTRY_NAME_TO_CODE[part.toLowerCase()]
      if (code && !codes.includes(code)) {
        codes.push(code)
      }
    }
    if (codes.length > 0) {
      return codes.join(',')
    }
  }
  
  // 未知格式，返回原值（截取前20个字符）
  return trimmed.length > 20 ? trimmed.substring(0, 20) : trimmed
}

