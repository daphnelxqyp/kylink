/**
 * 加密模块
 *
 * 提供 AES-256-CBC 加密/解密功能，用于保护敏感数据
 * 如：代理密码、API 凭证等
 */

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto'

// 加密算法配置
const ALGORITHM = 'aes-256-cbc'
const IV_LENGTH = 16
const KEY_LENGTH = 32
const SALT_LENGTH = 16

// 从环境变量获取加密密钥
// 如果未配置，使用默认密钥（仅用于开发环境，生产环境必须配置）
const ENCRYPTION_SECRET = process.env.ENCRYPTION_SECRET || 'kyads-default-secret-key-change-in-production'

/**
 * 从密码派生加密密钥
 */
function deriveKey(secret: string, salt: Buffer): Buffer {
  return scryptSync(secret, salt, KEY_LENGTH)
}

/**
 * 加密字符串
 *
 * 格式：salt:iv:encryptedData（均为 hex 编码）
 *
 * @param plaintext 明文
 * @returns 加密后的字符串
 */
export function encrypt(plaintext: string): string {
  if (!plaintext) return ''

  try {
    // 生成随机盐和 IV
    const salt = randomBytes(SALT_LENGTH)
    const iv = randomBytes(IV_LENGTH)

    // 派生密钥
    const key = deriveKey(ENCRYPTION_SECRET, salt)

    // 加密
    const cipher = createCipheriv(ALGORITHM, key, iv)
    const encrypted = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ])

    // 返回格式：salt:iv:encryptedData
    return `${salt.toString('hex')}:${iv.toString('hex')}:${encrypted.toString('hex')}`
  } catch (error) {
    console.error('[encryption] Encrypt error:', error)
    throw new Error('加密失败')
  }
}

/**
 * 解密字符串
 *
 * @param ciphertext 加密后的字符串（格式：salt:iv:encryptedData）
 * @returns 解密后的明文
 */
export function decrypt(ciphertext: string): string {
  if (!ciphertext) return ''

  try {
    // 解析加密数据
    const parts = ciphertext.split(':')
    if (parts.length !== 3) {
      // 可能是旧的未加密密码，直接返回
      console.warn('[encryption] Invalid ciphertext format, returning as-is (might be unencrypted legacy data)')
      return ciphertext
    }

    const salt = Buffer.from(parts[0], 'hex')
    const iv = Buffer.from(parts[1], 'hex')
    const encrypted = Buffer.from(parts[2], 'hex')

    // 验证长度
    if (salt.length !== SALT_LENGTH || iv.length !== IV_LENGTH) {
      // 格式不对，可能是未加密的旧数据
      console.warn('[encryption] Invalid salt/iv length, returning as-is')
      return ciphertext
    }

    // 派生密钥
    const key = deriveKey(ENCRYPTION_SECRET, salt)

    // 解密
    const decipher = createDecipheriv(ALGORITHM, key, iv)
    const decrypted = Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ])

    return decrypted.toString('utf8')
  } catch (error) {
    // 解密失败，可能是未加密的旧数据
    console.warn('[encryption] Decrypt failed, returning as-is (might be unencrypted legacy data):', error)
    return ciphertext
  }
}

/**
 * 检查字符串是否已加密
 *
 * @param value 待检查的字符串
 * @returns 是否已加密
 */
export function isEncrypted(value: string): boolean {
  if (!value) return false

  const parts = value.split(':')
  if (parts.length !== 3) return false

  // 检查各部分长度是否符合预期
  const saltHexLen = SALT_LENGTH * 2
  const ivHexLen = IV_LENGTH * 2

  return parts[0].length === saltHexLen &&
         parts[1].length === ivHexLen &&
         parts[2].length > 0 &&
         /^[0-9a-f]+$/i.test(parts[0]) &&
         /^[0-9a-f]+$/i.test(parts[1]) &&
         /^[0-9a-f]+$/i.test(parts[2])
}

/**
 * 加密密码（如果未加密）
 *
 * @param password 密码
 * @returns 加密后的密码
 */
export function encryptPassword(password: string): string {
  if (!password) return ''
  if (isEncrypted(password)) return password
  return encrypt(password)
}

/**
 * 解密密码
 *
 * @param encryptedPassword 加密的密码
 * @returns 明文密码
 */
export function decryptPassword(encryptedPassword: string): string {
  if (!encryptedPassword) return ''
  return decrypt(encryptedPassword)
}
