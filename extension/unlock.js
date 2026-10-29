const pinInput = document.getElementById('pin')
const errorEl = document.getElementById('error')
const hintEl = document.getElementById('hint')

const returnParam = new URLSearchParams(location.search).get('return')
const returnTo = returnParam === 'popup'
  ? 'popup.html'
  : returnParam === 'wizard'
    ? 'wizard.html'
    : 'options.html'

let busy = false
let timer = null

function showHint(failCount) {
  if (failCount >= Lock.MAX_FAILS) {
    hintEl.textContent = '已连续错误 ' + failCount + ' 次。若忘记密码，请卸载插件并重新配置。'
    hintEl.hidden = false
  }
}

async function attempt() {
  if (busy) return
  const pin = pinInput.value
  if (!Lock.isSixDigits(pin)) return

  busy = true
  pinInput.disabled = true
  try {
    const res = await Lock.unlock(pin)
    if (res.ok) {
      location.replace(returnTo)
      return
    }
    errorEl.textContent = 'PIN 错误，请重试'
    pinInput.value = ''
    showHint(res.failCount)
  } finally {
    busy = false
    pinInput.disabled = false
    pinInput.focus()
  }
}

pinInput.addEventListener('input', () => {
  const digits = pinInput.value.replace(/\D/g, '').slice(0, 6)
  if (digits !== pinInput.value) pinInput.value = digits
  if (digits.length === 6) {
    clearTimeout(timer)
    timer = setTimeout(attempt, 120)
  }
})

// 其他页面/标签解锁后，本页自动跳回
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.locked && changes.locked.newValue === false) {
    location.replace(returnTo)
  }
})

;(async () => {
  const state = await Lock.getState()
  if (!state.locked) {
    location.replace(returnTo)
    return
  }
  showHint(state.failCount)
  pinInput.focus()
})()
