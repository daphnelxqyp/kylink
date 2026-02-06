/**
 * 脚本模板 API
 * 返回 Google Ads Script 模板文件的原始内容，供前端替换配置后复制到剪贴板
 */
import { NextRequest, NextResponse } from 'next/server'
import { readFile } from 'fs/promises'
import { join } from 'path'

/** 脚本名称 → 文件路径映射 */
const SCRIPT_FILES: Record<string, string> = {
  sync: 'campaign_sync_to_sheet.js',
  swap: 'campaignto1.js',
}

/**
 * GET /api/v1/scripts/template?name=swap|sync
 * 读取项目根目录下的脚本文件并返回其文本内容
 */
export async function GET(request: NextRequest) {
  const name = request.nextUrl.searchParams.get('name')
  if (!name || !SCRIPT_FILES[name]) {
    return NextResponse.json(
      { success: false, error: '无效的脚本名称，可选值: sync, swap' },
      { status: 400 },
    )
  }

  try {
    const filePath = join(process.cwd(), SCRIPT_FILES[name])
    const content = await readFile(filePath, 'utf-8')
    return NextResponse.json({ success: true, content })
  } catch (err) {
    const message = err instanceof Error ? err.message : '读取脚本文件失败'
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 },
    )
  }
}

/** 标记为动态路由，防止 Next.js 静态生成 */
export const dynamic = 'force-dynamic'
