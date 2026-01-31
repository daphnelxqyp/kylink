/**
 * Vitest 测试环境配置
 *
 * 在所有测试运行前执行，用于设置全局测试环境
 */

import '@testing-library/jest-dom'
import { vi } from 'vitest'

// 设置环境变量（测试环境默认值）
process.env.ALLOW_MOCK_SUFFIX = 'true'
process.env.MAX_BATCH_SIZE = '500'
process.env.STOCK_CONCURRENCY = '5'
process.env.CAMPAIGN_CONCURRENCY = '3'

// Mock console 方法（减少测试输出噪音）
global.console = {
  ...console,
  log: vi.fn(),
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  // 保留 error，方便调试
}
