/**
 * EncryptionService — AES-256-GCM 加密/解密
 *
 * v9.2 Phase 3: 保护敏感字段的静态加密。
 * 使用 Node.js 内置 crypto 模块，AES-256-GCM 认证加密。
 *
 * 环境变量: MORPEX_ENCRYPTION_KEY (32字节 hex)
 *
 * 使用方式:
 *   const enc = new EncryptionService();
 *   const encrypted = enc.encrypt('{"apiKey":"sk-..."}');
 *   const decrypted = enc.decrypt(encrypted);
 */

import * as crypto from 'node:crypto'

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 16
const TAG_LENGTH = 16
const KEY_LENGTH = 32

export class EncryptionService {
  private key: Buffer

  /**
   * @param keyHex - 32-byte hex string. 默认从环境变量 MORPEX_ENCRYPTION_KEY 读取
   */
  constructor(keyHex?: string) {
    const k = keyHex ?? process.env.MORPEX_ENCRYPTION_KEY
    if (!k) {
      throw new Error('Encryption key required. Set MORPEX_ENCRYPTION_KEY env var or pass keyHex.')
    }
    this.key = Buffer.from(k, 'hex')
    if (this.key.length !== KEY_LENGTH) {
      throw new Error(`Key must be ${KEY_LENGTH} bytes (${KEY_LENGTH * 2} hex chars), got ${this.key.length} bytes`)
    }
  }

  /**
   * encrypt — 加密明文
   * @param plaintext - 明文字符串
   * @returns hex 编码密文 (格式: iv:tag:ciphertext)
   */
  encrypt(plaintext: string): string {
    const iv = crypto.randomBytes(IV_LENGTH)
    const cipher = crypto.createCipheriv(ALGORITHM, this.key, iv)
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf-8'), cipher.final()])
    const tag = cipher.getAuthTag()
    return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`
  }

  /**
   * decrypt — 解密密文
   * @param ciphertext - encrypt() 返回的 hex 密文
   * @returns 明文字符串
   */
  decrypt(ciphertext: string): string {
    const parts = ciphertext.split(':')
    if (parts.length !== 3) {
      throw new Error('Invalid ciphertext format. Expected iv:tag:ciphertext')
    }
    const iv = Buffer.from(parts[0], 'hex')
    const tag = Buffer.from(parts[1], 'hex')
    const encrypted = Buffer.from(parts[2], 'hex')
    const decipher = crypto.createDecipheriv(ALGORITHM, this.key, iv)
    decipher.setAuthTag(tag)
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()])
    return decrypted.toString('utf-8')
  }
}
