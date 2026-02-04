/**
 * 代理诊断接口
 *
 * GET /v1/admin/proxy-providers/diagnose?userId=xxx
 * 
 * 检查用户的代理配置状态，用于排查补货失败问题
 */

import { NextRequest } from 'next/server'
import prisma from '@/lib/prisma'
import { errorResponse, successResponse } from '@/lib/utils'
import { processUsernameTemplate, getProxyExitIp } from '@/lib/proxy-selector'
import type { SingleRequestProxy } from '@/lib/redirect/tracker'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const userId = searchParams.get('userId')
  const testCountry = searchParams.get('country') || 'US'
  const testConnection = searchParams.get('test') === 'true'

  try {
    // 1. 检查系统中所有代理供应商
    const allProviders = await prisma.proxyProvider.findMany({
      where: { deletedAt: null },
      select: {
        id: true,
        name: true,
        host: true,
        port: true,
        usernameTemplate: true,
        password: true,
        enabled: true,
        priority: true,
        assignedUsers: {
          select: {
            userId: true,
            user: {
              select: {
                id: true,
                email: true,
                name: true,
              },
            },
          },
        },
      },
      orderBy: { priority: 'asc' },
    })

    // 2. 如果指定了 userId，检查该用户的代理分配
    let userProviders: typeof allProviders = []
    let userInfo = null

    if (userId) {
      userInfo = await prisma.user.findFirst({
        where: { id: userId, deletedAt: null },
        select: { id: true, email: true, name: true },
      })

      if (userInfo) {
        userProviders = allProviders.filter(p =>
          p.assignedUsers.some(au => au.userId === userId)
        )
      }
    }

    // 3. 生成诊断报告
    const diagnosis = {
      summary: {
        totalProviders: allProviders.length,
        enabledProviders: allProviders.filter(p => p.enabled).length,
        userAssignedProviders: userProviders.length,
      },
      user: userInfo,
      userProviders: userProviders.map(p => ({
        id: p.id,
        name: p.name,
        host: p.host,
        port: p.port,
        enabled: p.enabled,
        priority: p.priority,
        usernameTemplate: p.usernameTemplate,
        // 测试用户名模板处理
        processedUsername: processUsernameTemplate(p.usernameTemplate || '', testCountry),
        hasPassword: !!p.password,
      })),
      allProviders: allProviders.map(p => ({
        id: p.id,
        name: p.name,
        host: p.host,
        port: p.port,
        enabled: p.enabled,
        priority: p.priority,
        assignedUserCount: p.assignedUsers.length,
        assignedUsers: p.assignedUsers.map(au => ({
          userId: au.userId,
          email: au.user?.email,
          name: au.user?.name,
        })),
      })),
    }

    // 4. 如果请求测试连接，尝试获取第一个代理的出口 IP
    type ConnectionTestResult = {
      provider: string
      success: boolean
      exitIp?: string
      error?: string
      processedUsername: string
    }
    let connectionTest: ConnectionTestResult | null = null
    
    if (testConnection && userProviders.length > 0) {
      const provider = userProviders[0]
      const username = processUsernameTemplate(provider.usernameTemplate || '', testCountry)
      const proxy: SingleRequestProxy = {
        url: `socks5://${provider.host}:${provider.port}`,
        username: username || undefined,
        password: provider.password || undefined,
        protocol: 'socks5',
      }

      try {
        const exitIpInfo = await getProxyExitIp(proxy, username, provider.password || '')
        connectionTest = {
          provider: provider.name,
          success: !!exitIpInfo,
          exitIp: exitIpInfo?.ip,
          processedUsername: username,
        }
      } catch (err) {
        connectionTest = {
          provider: provider.name,
          success: false,
          error: err instanceof Error ? err.message : String(err),
          processedUsername: username,
        }
      }
    }

    return successResponse({
      diagnosis,
      connectionTest,
      testCountry,
      recommendations: generateRecommendations(diagnosis, connectionTest),
    })
  } catch (error) {
    console.error('Proxy diagnose error:', error)
    return errorResponse('INTERNAL_ERROR', '诊断失败', 500)
  }
}

/**
 * 根据诊断结果生成建议
 */
function generateRecommendations(
  diagnosis: { summary: { totalProviders: number; enabledProviders: number; userAssignedProviders: number } },
  connectionTest: { success: boolean; error?: string } | null
): string[] {
  const recommendations: string[] = []

  if (diagnosis.summary.totalProviders === 0) {
    recommendations.push('系统中没有配置任何代理供应商，请先添加代理')
  } else if (diagnosis.summary.enabledProviders === 0) {
    recommendations.push('所有代理供应商都已禁用，请启用至少一个代理')
  }

  if (diagnosis.summary.userAssignedProviders === 0) {
    recommendations.push('当前用户没有被分配任何代理，请在代理管理页面分配代理给用户')
  }

  if (connectionTest && !connectionTest.success) {
    if (connectionTest.error?.includes('ECONNREFUSED')) {
      recommendations.push('代理连接被拒绝，请检查代理服务是否正常运行')
    } else if (connectionTest.error?.includes('timeout')) {
      recommendations.push('代理连接超时，请检查网络连通性或增加超时时间')
    } else if (connectionTest.error?.includes('auth') || connectionTest.error?.includes('SOCKS')) {
      recommendations.push('代理认证失败，请检查用户名模板和密码是否正确')
    } else {
      recommendations.push(`代理连接失败: ${connectionTest.error}`)
    }
  }

  if (recommendations.length === 0) {
    recommendations.push('代理配置看起来正常，如果仍有问题请检查服务器日志')
  }

  return recommendations
}
