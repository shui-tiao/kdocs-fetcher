// 锁定状态与 PIN 校验的公共模块（options / popup / unlock / wizard 共用）
(function () {
  const MAX_FAILS = 5

  function isSixDigits(value) {
    return /^\d{6}$/.test(value)
  }

  async function sha256Hex(text) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
    return Array.from(new Uint8Array(buf))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
  }

  async function getState() {
    const cfg = await chrome.storage.local.get(['locked', 'pinHash', 'failCount'])
    return {
      locked: Boolean(cfg.locked && cfg.pinHash),
      failCount: cfg.failCount || 0
    }
  }

  async function isLocked() {
    return (await getState()).locked
  }

  // 锁定：只保存 PIN 摘要，明文不入库
  async function lock(pin) {
    await chrome.storage.local.set({
      locked: true,
      pinHash: await sha256Hex(pin),
      failCount: 0
    })
  }

  // 解锁：校验通过后清除 PIN 摘要，下次锁定必须设置新的 PIN
  async function unlock(pin) {
    const cfg = await chrome.storage.local.get(['pinHash', 'failCount'])
    if (!cfg.pinHash) return { ok: true, failCount: 0 }

    if ((await sha256Hex(pin)) === cfg.pinHash) {
      await chrome.storage.local.remove('pinHash')
      await chrome.storage.local.set({ locked: false, failCount: 0 })
      return { ok: true, failCount: 0 }
    }

    const failCount = (cfg.failCount || 0) + 1
    await chrome.storage.local.set({ failCount })
    return { ok: false, failCount, exhausted: failCount >= MAX_FAILS }
  }

  window.Lock = { MAX_FAILS, isSixDigits, getState, isLocked, lock, unlock }
})()
