/**
 * 管理端代理供应商测试
 *
 * POST /v1/admin/proxy-providers/:id/test - 代理连通性测试
 * 
 * 测试逻辑：
 * 1. TCP 端口连通性测试 - 验证代理地址和端口是否可达
 * 2. 可选：通过 DNS 解析验证域名有效性
 */

import { NextRequest } from 'next/server'
import { createConnection, Socket } from 'net'
import { lookup } from 'dns/promises'
import prisma from '@/lib/prisma'
import { errorResponse, successResponse } from '@/lib/utils'

/**
 * TCP 端口连通性测试
 * 尝试建立 TCP 连接以验证代理服务器端口是否开放
 */
async function testTcpConnectivity(
  host: string,
  port: number,
  timeoutMs: number = 5000
): Promise<{ ok: boolean; message: string; latencyMs?: number }> {
  return new Promise((resolve) => {
    const startTime = Date.now()
    let socket: Socket | null = null
    let resolved = false

    // 超时处理
    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true
        socket?.destroy()
        resolve({
          ok: false,
          message: `连接超时（${timeoutMs}ms）。请检查代理地址和端口是否正确，或网络是否可达。`,
        })
      }
    }, timeoutMs)

    try {
      socket = createConnection({ host, port }, () => {
        // 连接成功
        if (!resolved) {
          resolved = true
          clearTimeout(timeout)
          const latencyMs = Date.now() - startTime
          socket?.destroy()
          resolve({
            ok: true,
            latencyMs,
            message: `TCP 连接成功！延迟 ${latencyMs}ms。端口已开放，代理服务正在运行。`,
          })
        }
      })

      socket.on('error', (error) => {
        if (!resolved) {
          resolved = true
          clearTimeout(timeout)
          socket?.destroy()

          // 根据错误类型提供更友好的提示
          let errorMessage = error.message
          if (error.message.includes('ECONNREFUSED')) {
            errorMessage = '连接被拒绝。代理服务器可能未启动或端口配置错误。'
          } else if (error.message.includes('ENOTFOUND')) {
            errorMessage = '域名解析失败。请检查代理地址是否正确。'
          } else if (error.message.includes('ETIMEDOUT')) {
            errorMessage = '连接超时。代理服务器可能不可达或被防火墙阻止。'
          } else if (error.message.includes('ENETUNREACH')) {
            errorMessage = '网络不可达。请检查网络连接。'
          }

          resolve({
            ok: false,
            message: errorMessage,
          })
        }
      })
    } catch (error) {
      if (!resolved) {
        resolved = true
        clearTimeout(timeout)
        resolve({
          ok: false,
          message: `创建连接失败：${error instanceof Error ? error.message : '未知错误'}`,
        })
      }
    }
  })
}

/**
 * DNS 解析测试（仅对域名进行）
 */
async function testDnsResolution(host: string): Promise<{ ok: boolean; message: string; ip?: string }> {
  // 检查是否是 IP 地址（简单判断）
  const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}$/
  if (ipv4Regex.test(host)) {
    return { ok: true, message: '直接 IP 地址，无需 DNS 解析', ip: host }
  }

  try {
    const result = await lookup(host)
    return {
      ok: true,
      message: `DNS 解析成功`,
      ip: result.address,
    }
  } catch (error) {
    return {
      ok: false,
      message: `DNS 解析失败：${error instanceof Error ? error.message : '未知错误'}。请检查代理地址是否正确。`,
    }
  }
}

export async function POST(request: NextRequest, context: { params: { id: string } }) {
  const providerId = context.params.id

  try {
    const provider = await prisma.proxyProvider.findFirst({
      where: { id: providerId, deletedAt: null },
      select: {
        id: true,
        name: true,
        host: true,
        port: true,
        enabled: true,
      },
    })

    if (!provider) {
      return errorResponse('NOT_FOUND', '代理供应商不存在或已删除', 404)
    }

    if (!provider.enabled) {
      return successResponse({
        ok: false,
        message: '该代理供应商已停用，无法测试。',
      })
    }

    // 步骤1：DNS 解析测试
    const dnsResult = await testDnsResolution(provider.host)
    if (!dnsResult.ok) {
      return successResponse({
        ok: false,
        message: dnsResult.message,
        details: { step: 'dns', host: provider.host },
      })
    }

    // 步骤2：TCP 端口连通性测试
    const tcpResult = await testTcpConnectivity(provider.host, provider.port)

    return successResponse({
      ok: tcpResult.ok,
      message: tcpResult.message,
      details: {
        host: provider.host,
        port: provider.port,
        resolvedIp: dnsResult.ip,
        latencyMs: tcpResult.latencyMs,
      },
    })
  } catch (error) {
    console.error('Admin test proxy provider error:', error)
    return errorResponse('INTERNAL_ERROR', '测试代理供应商失败', 500)
  }
}

