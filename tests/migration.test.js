// 加密迁移模块（extension/migration.js）的单元测试
// 运行：node --test tests/migration.test.js
const test = require('node:test')
const assert = require('node:assert/strict')

const Migration = require('../extension/migration.js')

const sampleConfig = {
  webhookUrl: 'https://www.kdocs.cn/api/v3/ide/file/abc/script/xyz/sync_task',
  token: 'secret-airscript-token',
  sheet: '项目',
  fields: ['内容', '机构=E', '日期:date'],
  order: 'bottom',
  autoCopyField: '内容',
  autoFetch: true,
  extraKey: 'should-be-filtered'
}

test('b64encode / b64decode 往返一致', () => {
  const bytes = Uint8Array.from([0, 1, 250, 255, 42])
  const decoded = Migration.b64decode(Migration.b64encode(bytes))
  assert.deepEqual(Array.from(decoded), Array.from(bytes))
})

test('b64decode 还原 base64 字符串的字节长度', () => {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  assert.equal(Migration.b64decode(Migration.b64encode(salt)).length, 16)
})

test('encryptConfig 返回合法的备份结构（v=1、16 字节盐、12 字节 IV）', async () => {
  const backup = await Migration.encryptConfig('123456', sampleConfig)
  assert.equal(backup.v, 1)
  assert.equal(Migration.b64decode(backup.salt).length, 16)
  assert.equal(Migration.b64decode(backup.iv).length, 12)
  assert.ok(backup.data.length > 0)
  // 密文中不应出现明文关键字
  assert.equal(backup.data.includes('secret-airscript-token'), false)
})

test('加密后解密往返还原原始配置', async () => {
  const backup = await Migration.encryptConfig('123456', sampleConfig)
  const cfg = await Migration.decryptConfig('123456', backup)
  assert.deepEqual(cfg, sampleConfig)
})

test('同样的 PIN + 盐派生相同密钥，可解密；不同盐则不能', async () => {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const key1 = await Migration.deriveKey('123456', salt)
  const key2 = await Migration.deriveKey('123456', salt)
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const plain = new TextEncoder().encode('hello')
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key1, plain)
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key2, cipher)
  assert.equal(new TextDecoder().decode(decrypted), 'hello')

  const key3 = await Migration.deriveKey('123456', crypto.getRandomValues(new Uint8Array(16)))
  await assert.rejects(() => crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key3, cipher))
})

test('错误 PIN 解密失败', async () => {
  const backup = await Migration.encryptConfig('123456', sampleConfig)
  await assert.rejects(() => Migration.decryptConfig('654321', backup))
})

test('密文被篡改后解密失败（AES-GCM 完整性校验）', async () => {
  const backup = await Migration.encryptConfig('123456', sampleConfig)
  const bytes = Migration.b64decode(backup.data)
  bytes[0] ^= 0xff
  const tampered = { ...backup, data: Migration.b64encode(bytes) }
  await assert.rejects(() => Migration.decryptConfig('123456', tampered))
})

test('两次加密产生不同的盐、IV 和密文', async () => {
  const a = await Migration.encryptConfig('123456', sampleConfig)
  const b = await Migration.encryptConfig('123456', sampleConfig)
  assert.notEqual(a.salt, b.salt)
  assert.notEqual(a.iv, b.iv)
  assert.notEqual(a.data, b.data)
})

test('sanitizeConfig 只保留已知配置键且不引入 undefined 字段', () => {
  const data = Migration.sanitizeConfig(sampleConfig)
  assert.deepEqual(Object.keys(data).sort(), [...Migration.CONFIG_KEYS].sort())
  assert.equal(data.extraKey, undefined)
  assert.equal(data.token, 'secret-airscript-token')
})

test('sanitizeConfig 处理缺少字段的配置', () => {
  const data = Migration.sanitizeConfig({ webhookUrl: 'https://www.kdocs.cn/x', fields: ['内容'] })
  assert.deepEqual(data, { webhookUrl: 'https://www.kdocs.cn/x', fields: ['内容'] })
})

test('解密损坏的备份（非法 base64 数据）时抛出异常', async () => {
  const backup = await Migration.encryptConfig('123456', sampleConfig)
  await assert.rejects(() => Migration.decryptConfig('123456', { ...backup, data: '!!!not-base64!!!' }))
})
