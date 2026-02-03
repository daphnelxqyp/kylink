/**
 * POST /v1/campaigns/sync
 * 
 * Campaign 元数据增量同步
 * 
 * 核心逻辑（PRD 5.4）：
 * - 幂等：相同数据多次同步，结果一致
 * - 变化检测：检测 campaignName、country、finalUrl 是否变化
 * - finalUrl 变化告警：返回 warning 提示运营核查
 */

import { NextRequest } from 'next/server'
import prisma from '@/lib/prisma'
import { authenticateRequest } from '@/lib/auth'
import { 
  parseJsonBody, 
  validateRequired, 
  successResponse, 
  errorResponse,
} from '@/lib/utils'

// Campaign 数据类型
interface CampaignData {
  campaignId: string
  campaignName: string
  country: string
  finalUrl: string
  cid: string
  mccId: string
}

// 请求体类型
interface SyncRequest {
  campaigns: CampaignData[]
  syncMode: 'incremental' | 'full'
}

// 警告信息类型
interface SyncWarning {
  campaignId: string
  message: string
}

export async function POST(request: NextRequest) {
  // 1. 鉴权
  const authResult = await authenticateRequest(request)
  if (!authResult.success) {
    return errorResponse(
      authResult.error!.code,
      authResult.error!.message,
      authResult.error!.status
    )
  }
  const userId = authResult.userId!

  // 2. 解析请求体
  const { data, error: parseError } = await parseJsonBody<SyncRequest>(request)
  if (parseError || !data) {
    return errorResponse('VALIDATION_ERROR', parseError || '请求体解析失败', 422)
  }

  // 3. 验证必填字段
  const { valid, missing } = validateRequired(data, ['campaigns', 'syncMode'])
  if (!valid) {
    return errorResponse('VALIDATION_ERROR', `缺少必填字段: ${missing.join(', ')}`, 422)
  }

  // 4. 验证 campaigns 数组
  if (!Array.isArray(data.campaigns)) {
    return errorResponse('VALIDATION_ERROR', 'campaigns 必须是数组', 422)
  }

  if (data.campaigns.length === 0) {
    return errorResponse('VALIDATION_ERROR', 'campaigns 不能为空', 422)
  }

  if (data.campaigns.length > 200) {
    return errorResponse('VALIDATION_ERROR', 'campaigns 单次最多 200 条', 422)
  }

  // 5. 验证 syncMode
  if (!['incremental', 'full'].includes(data.syncMode)) {
    return errorResponse('VALIDATION_ERROR', 'syncMode 必须是 incremental 或 full', 422)
  }

  const { campaigns, syncMode } = data

  // 统计计数
  let created = 0
  let updated = 0
  let unchanged = 0
  const warnings: SyncWarning[] = []

  try {
    // 6. 获取现有的 campaign 数据
    const campaignIds = campaigns.map((c: CampaignData) => c.campaignId)
    const existingCampaigns = await prisma.campaignMeta.findMany({
      where: {
        userId,
        campaignId: { in: campaignIds },
        deletedAt: null,
      },
    })

    // 建立查找映射
    type ExistingCampaign = typeof existingCampaigns[number]
    const existingMap = new Map(existingCampaigns.map((c: ExistingCampaign) => [c.campaignId, c]))

    // 7. 处理每个 campaign
    for (const campaign of campaigns) {
      // 验证必填字段
      const campaignValid = validateRequired(campaign, [
        'campaignId',
        'campaignName',
        'country',
        'finalUrl',
        'cid',
        'mccId',
      ])
      
      if (!campaignValid.valid) {
        warnings.push({
          campaignId: campaign.campaignId || 'unknown',
          message: `缺少字段: ${campaignValid.missing.join(', ')}`,
        })
        continue
      }

      const existing = existingMap.get(campaign.campaignId)

      if (!existing) {
        // 新建
        await prisma.campaignMeta.create({
          data: {
            userId,
            campaignId: campaign.campaignId,
            campaignName: campaign.campaignName,
            country: campaign.country,
            finalUrl: campaign.finalUrl,
            cid: campaign.cid,
            mccId: campaign.mccId,
            status: 'active',
            lastSyncedAt: new Date(),
          },
        })
        created++
      } else {
        // 检查是否有变化
        const hasChange =
          existing.campaignName !== campaign.campaignName ||
          existing.country !== campaign.country ||
          existing.finalUrl !== campaign.finalUrl ||
          existing.cid !== campaign.cid ||
          existing.mccId !== campaign.mccId

        if (hasChange) {
          // 检查 finalUrl 变化，需要告警
          if (existing.finalUrl !== campaign.finalUrl) {
            warnings.push({
              campaignId: campaign.campaignId,
              message: 'finalUrl 已变化，请检查联盟链接配置',
            })
          }

          // 更新
          await prisma.campaignMeta.update({
            where: { id: existing.id },
            data: {
              campaignName: campaign.campaignName,
              country: campaign.country,
              finalUrl: campaign.finalUrl,
              cid: campaign.cid,
              mccId: campaign.mccId,
              status: 'active',
              lastSyncedAt: new Date(),
            },
          })
          updated++
        } else {
          // 无变化，仅更新同步时间
          await prisma.campaignMeta.update({
            where: { id: existing.id },
            data: {
              lastSyncedAt: new Date(),
            },
          })
          unchanged++
        }
      }
    }

    // 8. 全量同步模式：标记未上报的 campaign 为 inactive
    if (syncMode === 'full') {
      const reportedIds = campaigns.map((c: CampaignData) => c.campaignId)
      await prisma.campaignMeta.updateMany({
        where: {
          userId,
          campaignId: { notIn: reportedIds },
          status: 'active',
          deletedAt: null,
        },
        data: {
          status: 'inactive',
        },
      })
    }

    // 9. 返回结果
    return successResponse({
      ok: true,
      created,
      updated,
      unchanged,
      warnings: warnings.length > 0 ? warnings : undefined,
    })

  } catch (error) {
    console.error('Sync error:', error)
    return errorResponse('INTERNAL_ERROR', '服务内部错误，请稍后重试', 500)
  }
}

