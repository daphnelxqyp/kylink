/**
 * 广告系列导入 API
 * 
 * POST /v1/campaigns/import - 从 Google Spreadsheet 导入广告系列数据
 * 
 * 功能：
 * - 支持多个 Spreadsheet URL
 * - 增量更新（upsert）
 * - 失败不中断，记录错误继续处理
 */

import { NextRequest } from 'next/server'
import prisma from '@/lib/prisma'
import { errorResponse, successResponse } from '@/lib/utils'
import {
  convertGeoToCountryCode,
  extractRootDomain,
  fetchSheetData,
  validateCampaignHeaders,
  type SheetCampaignRow,
} from '@/lib/google-sheet-reader'

// ================= 类型定义 =================

interface ImportRequest {
  spreadsheetUrls: string[]
  userId?: string // 可选，不传则使用第一个活跃用户
}

interface SheetImportResult {
  url: string
  success: boolean
  imported: number
  created: number
  updated: number
  affiliateLinksCreated: number
  affiliateLinksUpdated: number
  error?: string
}

interface ImportResponse {
  totalImported: number
  totalCreated: number
  totalUpdated: number
  totalAffiliateLinksCreated: number
  totalAffiliateLinksUpdated: number
  sheetResults: SheetImportResult[]
  errors: string[]
}

// ================= 导入处理 =================

export async function POST(request: NextRequest) {
  try {
    // 解析请求体
    const body = await request.json() as ImportRequest
    const { spreadsheetUrls, userId: requestUserId } = body

    // 验证参数
    if (!spreadsheetUrls || !Array.isArray(spreadsheetUrls) || spreadsheetUrls.length === 0) {
      return errorResponse('INVALID_PARAMS', '请提供至少一个 Spreadsheet URL', 400)
    }

    // 过滤空 URL
    const validUrls = spreadsheetUrls
      .map(url => url?.trim())
      .filter(Boolean)

    if (validUrls.length === 0) {
      return errorResponse('INVALID_PARAMS', '请提供有效的 Spreadsheet URL', 400)
    }

    // 获取用户 ID
    let userId = requestUserId

    if (!userId) {
      // 未指定用户时，获取第一个活跃用户
      const defaultUser = await prisma.user.findFirst({
        where: {
          status: 'active',
          deletedAt: null,
        },
        orderBy: {
          createdAt: 'asc',
        },
        select: {
          id: true,
        },
      })

      if (!defaultUser) {
        return errorResponse('NO_USER', '系统中没有可用用户，请先创建用户', 400)
      }

      userId = defaultUser.id
    }

    // 验证用户是否存在
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, status: true, deletedAt: true },
    })

    if (!user || user.deletedAt || user.status !== 'active') {
      return errorResponse('USER_NOT_FOUND', '指定用户不存在或已禁用', 400)
    }

    // 导入前先软删除该用户的所有广告系列（保证数据与表格完全同步）
    const deleteResult = await prisma.campaignMeta.updateMany({
      where: {
        userId,
        deletedAt: null,
      },
      data: {
        deletedAt: new Date(),
      },
    })
    console.log(`Soft deleted ${deleteResult.count} existing campaigns for user ${userId}`)

    // 处理结果
    const response: ImportResponse = {
      totalImported: 0,
      totalCreated: 0,
      totalUpdated: 0,
      totalAffiliateLinksCreated: 0,
      totalAffiliateLinksUpdated: 0,
      sheetResults: [],
      errors: [],
    }

    // 依次处理每个表格（串行避免并发问题）
    for (const url of validUrls) {
      const result = await importFromSheet(url, userId)
      response.sheetResults.push(result)

      if (result.success) {
        response.totalImported += result.imported
        response.totalCreated += result.created
        response.totalUpdated += result.updated
        response.totalAffiliateLinksCreated += result.affiliateLinksCreated
        response.totalAffiliateLinksUpdated += result.affiliateLinksUpdated
      } else if (result.error) {
        response.errors.push(`${url}: ${result.error}`)
      }
    }

    return successResponse(response)
  } catch (error) {
    console.error('Campaign import error:', error)
    return errorResponse('INTERNAL_ERROR', '导入失败，请稍后重试', 500)
  }
}

// ================= 单个表格导入 =================

async function importFromSheet(url: string, userId: string): Promise<SheetImportResult> {
  const result: SheetImportResult = {
    url,
    success: false,
    imported: 0,
    created: 0,
    updated: 0,
    affiliateLinksCreated: 0,
    affiliateLinksUpdated: 0,
  }

  // 1. 读取表格数据
  const fetchResult = await fetchSheetData<SheetCampaignRow>(url)

  if (!fetchResult.success) {
    result.error = fetchResult.error || '读取表格失败'
    return result
  }

  if (fetchResult.rowCount === 0) {
    result.error = '表格数据为空'
    return result
  }

  // 2. 验证表头
  const headerValidation = validateCampaignHeaders(fetchResult.headers)
  if (!headerValidation.valid) {
    result.error = `缺少必要字段: ${headerValidation.missing.join(', ')}`
    return result
  }

  // 3. 处理每条数据
  const campaigns = fetchResult.data

  for (const campaign of campaigns) {
    // 跳过无效数据
    if (!campaign.campaignId || !campaign.cid || !campaign.mccId) {
      continue
    }

    try {
      // 检查是否已存在（包括已软删除的记录）
      const existing = await prisma.campaignMeta.findFirst({
        where: {
          userId,
          campaignId: campaign.campaignId,
        },
        select: { id: true, deletedAt: true },
      })

      // 构建数据（将国家全称转换为简称，域名转换为根域名）
      const countryCode = convertGeoToCountryCode(campaign.country)
      const rootDomain = extractRootDomain(campaign.finalUrl)
      const campaignData = {
        campaignName: campaign.campaignName || null,
        country: countryCode || null,
        finalUrl: rootDomain || null,
        cid: campaign.cid,
        mccId: campaign.mccId,
        lastImportedAt: new Date(),
        deletedAt: null, // 恢复软删除
        status: 'active' as const,
      }

      if (existing) {
        // 更新现有记录（并恢复软删除）
        await prisma.campaignMeta.update({
          where: { id: existing.id },
          data: campaignData,
        })
        result.updated++
      } else {
        // 创建新记录
        await prisma.campaignMeta.create({
          data: {
            userId,
            campaignId: campaign.campaignId,
            ...campaignData,
          },
        })
        result.created++
      }

      // 处理 AffiliateLink（如果 trackingUrl 存在）
      const trackingUrl = campaign.trackingUrl?.trim()
      if (trackingUrl) {
        try {
          // 验证 URL 格式
          new URL(trackingUrl)

          // 查找现有的 AffiliateLink
          const existingLink = await prisma.affiliateLink.findFirst({
            where: {
              userId,
              campaignId: campaign.campaignId,
              deletedAt: null,
            },
            select: { id: true, url: true },
          })

          if (existingLink) {
            // 更新现有链接（仅当 URL 变化时）
            if (existingLink.url !== trackingUrl) {
              await prisma.affiliateLink.update({
                where: { id: existingLink.id },
                data: { url: trackingUrl },
              })
              result.affiliateLinksUpdated++
            }
          } else {
            // 创建新的 AffiliateLink
            await prisma.affiliateLink.create({
              data: {
                userId,
                campaignId: campaign.campaignId,
                url: trackingUrl,
                enabled: true,
                priority: 0,
              },
            })
            result.affiliateLinksCreated++
          }
        } catch (urlError) {
          // URL 格式无效，跳过
          console.warn(`Invalid trackingUrl for campaign ${campaign.campaignId}: ${trackingUrl}`)
        }
      }

      result.imported++
    } catch (error) {
      // 单条记录失败不中断，继续处理
      console.error(`Import campaign ${campaign.campaignId} failed:`, error)
    }
  }

  result.success = true
  return result
}

