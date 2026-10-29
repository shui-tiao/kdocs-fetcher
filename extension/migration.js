// 加密迁移的公共模块：PIN 派生密钥加密配置，经 storage.sync 跨设备同步
// 同时支持浏览器（window.Migration）与 Node（module.exports，供单元测试使用）
;(function (root, factory) {
  const api = factory()
  if (typeof module !== 'undefined' && module.exports) module.exports = api
  else root.Migration = api
})(typeof window !== 'undefined' ? window : globalThis, () => {
  const SYNC_KEY = 'cloudBackup'
  const CONFIG_KEYS = ['webhookUrl', 'token', 'sheet', 'fields', 'order', 'autoCopyField', 'autoFetch']

  function b64encode(buf) {
    return btoa(String.fromCharCode(...new Uint8Array(buf)))
  }

  function b64decode(str) {
    return Uint8Array.from(atob(str), (c) => c.charCodeAt(0))
  }

  async function deriveKey(pin, salt) {
    const baseKey = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveKey'])
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
      baseKey,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    )
  }

  // 加密配置，返回存入 storage.sync 的备份对象
  async function encryptConfig(pin, cfg) {
    const salt = crypto.getRandomValues(new Uint8Array(16))
    const iv = crypto.getRandomValues(new Uint8Array(12))
    const key = await deriveKey(pin, salt)
    const plain = new TextEncoder().encode(JSON.stringify(cfg))
    const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plain)
    return { v: 1, salt: b64encode(salt), iv: b64encode(iv), data: b64encode(cipher) }
  }

  // 解密备份，PIN 错误或数据损坏时抛出异常
  async function decryptConfig(pin, backup) {
    const key = await deriveKey(pin, b64decode(backup.salt))
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: b64decode(backup.iv) },
      key,
      b64decode(backup.data)
    )
    return JSON.parse(new TextDecoder().decode(plain))
  }

  // 还原前过滤：只保留已知配置键中实际存在的字段
  function sanitizeConfig(cfg) {
    const data = {}
    for (const k of CONFIG_KEYS) {
      if (cfg[k] !== undefined) data[k] = cfg[k]
    }
    return data
  }

  return { SYNC_KEY, CONFIG_KEYS, b64encode, b64decode, deriveKey, encryptConfig, decryptConfig, sanitizeConfig }
})
