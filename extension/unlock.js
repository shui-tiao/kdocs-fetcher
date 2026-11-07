const pinInput = document.getElementById('pin')
const errorEl = document.getElementById('error')
const hintEl = document.getElementById('hint')
const pinBoxesEl = document.getElementById('pinBoxes')
const unlockBtn = document.getElementById('unlockBtn')
const boxes = pinBoxesEl.children

const returnParam = new URLSearchParams(location.search).get('return')
const returnTo = returnParam === 'popup'
  ? 'popup.html'
  : returnParam === 'wizard'
    ? 'wizard.html'
    : 'options.html'

let busy = false
let timer = null

// 六格回显：已输入位数 = 实心格；焦点格描边加深
function renderBoxes() {
  const n = pinInput.value.length
  for (let i = 0; i < 6; i++) {
    boxes[i].classList.toggle('filled', i < n)
    boxes[i].classList.toggle('cur', i === n && document.activeElement === pinInput)
  }
}

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
  unlockBtn.disabled = true
  try {
    const res = await Lock.unlock(pin)
    if (res.ok) {
      location.replace(returnTo)
      return
    }
    // 错误态：方框清空 + 一行红字，无抖动等惩罚性动效
    errorEl.textContent = 'PIN 不正确，请重试'
    pinInput.value = ''
    renderBoxes()
    showHint(res.failCount)
  } finally {
    busy = false
    pinInput.disabled = false
    unlockBtn.disabled = false
    pinInput.focus()
    renderBoxes()
  }
}

pinInput.addEventListener('input', () => {
  const digits = pinInput.value.replace(/\D/g, '').slice(0, 6)
  if (digits !== pinInput.value) pinInput.value = digits
  errorEl.textContent = ''
  renderBoxes()
  if (digits.length === 6) {
    clearTimeout(timer)
    timer = setTimeout(attempt, 120)
  }
})

pinInput.addEventListener('focus', renderBoxes)
pinInput.addEventListener('blur', renderBoxes)
// 点方框区即聚焦隐藏输入框，弹出键盘
pinBoxesEl.addEventListener('click', () => pinInput.focus())
// C 稿单按钮：显式解锁入口（输满 6 位仍保留自动尝试，行为与原实现一致）
unlockBtn.addEventListener('click', () => {
  if (!Lock.isSixDigits(pinInput.value)) {
    pinInput.focus()
    return
  }
  attempt()
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
  renderBoxes()
})()
