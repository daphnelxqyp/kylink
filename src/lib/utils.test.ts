/**
 * Utils 测试
 *
 * 测试通用工具函数：
 * 1. 窗口时间计算
 * 2. 幂等键生成
 * 3. 字段验证
 * 4. 周期验证
 */

import { describe, it, expect } from 'vitest'
import {
  calculateWindowStart,
  generateIdempotencyKey,
  validateRequired,
  validateCycleMinutes,
  CYCLE_CONFIG,
  BATCH_CONFIG,
  STOCK_CONFIG,
  DYNAMIC_WATERMARK_CONFIG,
} from '@/lib/utils'

describe('Utils', () => {
  describe('calculateWindowStart', () => {
    it('应该正确计算窗口开始时间（10分钟周期）', () => {
      // 2024-01-01 10:15:30 -> 2024-01-01 10:10:00
      const timestamp = new Date('2024-01-01T10:15:30Z').getTime()
      const result = calculateWindowStart(10, timestamp)
      const expected = Math.floor(new Date('2024-01-01T10:10:00Z').getTime() / 1000)

      expect(result).toBe(expected)
    })

    it('应该正确计算窗口开始时间（30分钟周期）', () => {
      // 2024-01-01 10:45:30 -> 2024-01-01 10:30:00
      const timestamp = new Date('2024-01-01T10:45:30Z').getTime()
      const result = calculateWindowStart(30, timestamp)
      const expected = Math.floor(new Date('2024-01-01T10:30:00Z').getTime() / 1000)

      expect(result).toBe(expected)
    })

    it('应该在边界时间正确对齐', () => {
      // 2024-01-01 10:00:00 -> 2024-01-01 10:00:00
      const timestamp = new Date('2024-01-01T10:00:00Z').getTime()
      const result = calculateWindowStart(10, timestamp)
      const expected = Math.floor(new Date('2024-01-01T10:00:00Z').getTime() / 1000)

      expect(result).toBe(expected)
    })

    it('应该使用当前时间（未提供 timestamp）', () => {
      const before = Math.floor(Date.now() / 1000)
      const result = calculateWindowStart(10)
      const after = Math.floor(Date.now() / 1000)

      // 结果应该在 before 和 after 之间（允许一些误差）
      expect(result).toBeGreaterThanOrEqual(before - 600) // 10分钟前
      expect(result).toBeLessThanOrEqual(after)
    })
  })

  describe('generateIdempotencyKey', () => {
    it('应该生成正确格式的幂等键', () => {
      const result = generateIdempotencyKey('campaign-123', 1704096000)

      expect(result).toBe('campaign-123:1704096000')
    })

    it('应该为不同的 campaign 生成不同的键', () => {
      const key1 = generateIdempotencyKey('campaign-1', 1704096000)
      const key2 = generateIdempotencyKey('campaign-2', 1704096000)

      expect(key1).not.toBe(key2)
    })

    it('应该为不同的窗口生成不同的键', () => {
      const key1 = generateIdempotencyKey('campaign-123', 1704096000)
      const key2 = generateIdempotencyKey('campaign-123', 1704096600)

      expect(key1).not.toBe(key2)
    })
  })

  describe('validateRequired', () => {
    it('应该验证所有必填字段存在', () => {
      const data = {
        name: 'Test',
        email: 'test@example.com',
        age: 25,
      }

      const result = validateRequired(data, ['name', 'email', 'age'])

      expect(result.valid).toBe(true)
      expect(result.missing).toHaveLength(0)
    })

    it('应该检测缺失的字段', () => {
      const data = {
        name: 'Test',
        age: 25,
      }

      const result = validateRequired(data, ['name', 'email', 'age'])

      expect(result.valid).toBe(false)
      expect(result.missing).toContain('email')
    })

    it('应该检测空字符串', () => {
      const data = {
        name: '',
        email: 'test@example.com',
      }

      const result = validateRequired(data, ['name', 'email'])

      expect(result.valid).toBe(false)
      expect(result.missing).toContain('name')
    })

    it('应该检测 null 值', () => {
      const data = {
        name: 'Test',
        email: null,
      }

      const result = validateRequired(data, ['name', 'email'])

      expect(result.valid).toBe(false)
      expect(result.missing).toContain('email')
    })

    it('应该检测 undefined 值', () => {
      const data = {
        name: 'Test',
      }

      const result = validateRequired(data, ['name', 'email'])

      expect(result.valid).toBe(false)
      expect(result.missing).toContain('email')
    })
  })

  describe('validateCycleMinutes', () => {
    it('应该接受有效的周期值', () => {
      expect(validateCycleMinutes(10)).toBe(true)
      expect(validateCycleMinutes(30)).toBe(true)
      expect(validateCycleMinutes(60)).toBe(true)
    })

    it('应该拒绝小于最小值的周期', () => {
      expect(validateCycleMinutes(5)).toBe(false)
      expect(validateCycleMinutes(9)).toBe(false)
    })

    it('应该拒绝大于最大值的周期', () => {
      expect(validateCycleMinutes(61)).toBe(false)
      expect(validateCycleMinutes(120)).toBe(false)
    })

    it('应该接受边界值', () => {
      expect(validateCycleMinutes(CYCLE_CONFIG.MIN_CYCLE_MINUTES)).toBe(true)
      expect(validateCycleMinutes(CYCLE_CONFIG.MAX_CYCLE_MINUTES)).toBe(true)
    })
  })

  describe('配置常量', () => {
    it('CYCLE_CONFIG 应该有正确的值', () => {
      expect(CYCLE_CONFIG.MIN_CYCLE_MINUTES).toBe(10)
      expect(CYCLE_CONFIG.MAX_CYCLE_MINUTES).toBe(60)
      expect(CYCLE_CONFIG.DEFAULT_CYCLE_MINUTES).toBe(10)
    })

    it('BATCH_CONFIG 应该有正确的值', () => {
      expect(BATCH_CONFIG.MAX_BATCH_SIZE).toBeGreaterThan(0)
      expect(BATCH_CONFIG.DEFAULT_BATCH_SIZE).toBe(100)
    })

    it('STOCK_CONFIG 应该有正确的值', () => {
      expect(STOCK_CONFIG.PRODUCE_BATCH_SIZE).toBeGreaterThan(0)
    })

    it('DYNAMIC_WATERMARK_CONFIG 应该有正确的值', () => {
      expect(DYNAMIC_WATERMARK_CONFIG.HISTORY_WINDOW_HOURS).toBe(24)
      expect(DYNAMIC_WATERMARK_CONFIG.SAFETY_FACTOR).toBe(2)
      expect(DYNAMIC_WATERMARK_CONFIG.DEFAULT_WATERMARK).toBe(5)
      expect(DYNAMIC_WATERMARK_CONFIG.MIN_WATERMARK).toBe(3)
      expect(DYNAMIC_WATERMARK_CONFIG.MAX_WATERMARK).toBe(20)
      expect(DYNAMIC_WATERMARK_CONFIG.MIN_WATERMARK).toBeLessThan(DYNAMIC_WATERMARK_CONFIG.MAX_WATERMARK)
    })
  })
})
