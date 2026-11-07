// 内容脚本：接收后台消息，在页面上显示「获取中 x%」进度气泡，
// 拉取完成后把字段值插入当前聚焦的可编辑元素，并以气泡反馈成功/失败
;(() => {
  // 防止动态注入导致重复注册监听器（重复粘贴）
  if (window.__kdocsFetcherContent) return
  window.__kdocsFetcherContent = true

  let toastEl = null
  let hideTimer = null
  let progressTimer = null

  // C 稿色板（paste-toast.html）：成功 #1d9a4e / 失败 #d5483c / 进度中性黑 #17181a
  const TOAST_COLORS = { ok: '#1d9a4e', error: '#d5483c', progress: '#17181a' }
  function toastColor(kind) {
    return TOAST_COLORS[kind] || TOAST_COLORS.progress
  }
  // 成功文案带数据摘要：值较长时截前 10 字
  function previewOf(value) {
    const s = String(value)
    return s.length > 10 ? s.slice(0, 10) + '…' : s
  }

  // 气泡跟随当前输入框：定位在输入框上方居中；找不到输入框时回退到页面顶部居中
  // kind: progress(中性黑) / ok(绿) / error(红)
  function showToast(text, kind) {
    if (!toastEl) {
      toastEl = document.createElement('div')
      toastEl.style.cssText =
        'position:fixed;top:0;left:0;z-index:2147483647;' +
        'max-width:80vw;box-sizing:border-box;padding:7px 14px;font:600 12px/1.6 sans-serif;' +
        'color:#fff;background:#17181a;border-radius:999px;box-shadow:0 6px 16px rgba(23,24,26,.18);' +
        'opacity:0;pointer-events:none;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;'
      document.documentElement.appendChild(toastEl)
      toastEl.textContent = text
      toastEl.style.backgroundColor = toastColor(kind)
      // 首次显示不加位移过渡，先直接在目标位置出现，避免气泡从左上角飞入
      applyToastPosition()
      void toastEl.offsetWidth
      toastEl.style.transition = 'opacity .15s ease, left .18s ease, top .18s ease'
      toastEl.style.opacity = '1'
      // 气泡 pop 入场（Web Animations API，兼容页面 CSP）
      try {
        toastEl.animate(
          [{ transform: 'scale(.9)', opacity: '0' }, { transform: 'scale(1)', opacity: '1' }],
          { duration: 250, easing: 'ease-out' }
        )
      } catch (_) {}
      clearTimeout(hideTimer)
      return
    }
    toastEl.textContent = text
    toastEl.style.backgroundColor = toastColor(kind)
    toastEl.style.opacity = '1'
    positionToast()
    clearTimeout(hideTimer)
  }

  // 计算气泡应处的坐标：输入框上方居中，空间不足时放到下方，并限制在视口内
  function calcToastPosition() {
    const el = document.activeElement
    const rect = el && el !== document.body ? el.getBoundingClientRect() : null
    const w = toastEl.offsetWidth
    const h = toastEl.offsetHeight
    const GAP = 8
    let left, top
    if (rect && rect.width && rect.height) {
      left = rect.left + rect.width / 2 - w / 2
      top = rect.top - h - GAP
      // 输入框离顶部太近时放到输入框下方，避免超出视口
      if (top < 4) top = rect.bottom + GAP
    } else {
      left = window.innerWidth / 2 - w / 2
      top = 20
    }
    // 限制在视口内
    left = Math.max(4, Math.min(left, window.innerWidth - w - 4))
    top = Math.max(4, Math.min(top, window.innerHeight - h - 4))
    return { left, top }
  }

  function applyToastPosition() {
    if (!toastEl) return
    const { left, top } = calcToastPosition()
    toastEl.style.left = left + 'px'
    toastEl.style.top = top + 'px'
  }

  // 输入框切换/滚动时重新定位，位移由 CSS transition 平滑过渡
  function positionToast() {
    if (!toastEl) return
    const { left, top } = calcToastPosition()
    // 位置未变化时不写入样式，避免打断正在进行的过渡
    if (toastEl.style.left === left + 'px' && toastEl.style.top === top + 'px') return
    toastEl.style.left = left + 'px'
    toastEl.style.top = top + 'px'
  }

  function hideToast(delay) {
    clearTimeout(hideTimer)
    hideTimer = setTimeout(() => {
      if (toastEl) toastEl.style.opacity = '0'
      stopFollowing()
    }, delay)
  }

  // 气泡显示期间跟随滚动/窗口尺寸/焦点变化重新定位
  let following = false
  function startFollowing() {
    if (following) return
    following = true
    window.addEventListener('scroll', positionToast, true)
    window.addEventListener('resize', positionToast)
    // 焦点切换（如逐字粘贴时焦点逐个移入各输入框）时平滑跟随
    document.addEventListener('focusin', positionToast, true)
    document.addEventListener('focusout', onFocusOut, true)
  }
  function onFocusOut() {
    // focusout 后新焦点在下一个微任务才生效，延迟一帧再定位
    requestAnimationFrame(positionToast)
  }
  function stopFollowing() {
    if (!following) return
    following = false
    window.removeEventListener('scroll', positionToast, true)
    window.removeEventListener('resize', positionToast)
    document.removeEventListener('focusin', positionToast, true)
    document.removeEventListener('focusout', onFocusOut, true)
  }

  // 拉取期间没有真实进度可取，用渐近动画推进到 90%，完成后由消息置为 100%
  function startProgress() {
    stopProgress()
    startFollowing()
    let p = 0
    showToast('获取中 0%', 'loading')
    progressTimer = setInterval(() => {
      p = Math.min(90, p + Math.max(2, (90 - p) * 0.12))
      showToast('获取中 ' + Math.round(p) + '%', 'loading')
    }, 250)
  }

  function stopProgress() {
    clearInterval(progressTimer)
    progressTimer = null
  }

  function isEditable(el) {
    if (!el || el.disabled || el.readOnly) return false
    const tag = el.tagName
    return (
      tag === 'TEXTAREA' ||
      (tag === 'INPUT' && /^(?:text|search|url|tel|password|email|number|)$/.test(el.type || '')) ||
      el.isContentEditable
    )
  }

  function insertText(el, text) {
    el.focus()
    try {
      // insertText 走浏览器编辑路径，能触发 input 事件，兼容 React/Vue 受控组件
      document.execCommand('insertText', false, text)
      return true
    } catch (_) {
      return false
    }
  }

  // 一次性整段粘贴
  function pasteValue(value) {
    const el = document.activeElement
    if (!isEditable(el)) return false
    return insertText(el, value)
  }

  // 单字符输入框的判定：宽度相对起始框较窄，或 maxlength 为 1
  function isCharBox(el, startRect) {
    const r = el.getBoundingClientRect()
    if (!r.width || !r.height) return false
    if (el.getAttribute && el.getAttribute('maxlength') === '1') return true
    return r.width <= Math.max(startRect.width * 0.9, startRect.height * 1.6)
  }

  // 逐字粘贴用：在起始输入框所在行内，按从左到右的顺序找出同样单字符宽度的输入框
  // 适配验证码「一位一个输入框」的场景
  function findCharBoxes(start) {
    const rect = start.getBoundingClientRect()
    if (!rect.width || !rect.height) return [start]
    const midY = rect.top + rect.height / 2
    const boxes = []
    for (const el of document.querySelectorAll('input, textarea')) {
      if (!isEditable(el) || el === start) continue
      const r = el.getBoundingClientRect()
      if (!r.width || !r.height) continue
      // 同一行：垂直方向中心点接近
      if (Math.abs(r.top + r.height / 2 - midY) > Math.min(r.height, rect.height) / 2) continue
      if (!isCharBox(el, rect)) continue
      boxes.push({ el, left: r.left })
    }
    boxes.push({ el: start, left: rect.left })
    boxes.sort((a, b) => a.left - b.left)
    return boxes.map((b) => b.el)
  }

  function clearElement(el) {
    el.focus()
    if (el.isContentEditable) {
      el.textContent = ''
      el.dispatchEvent(new InputEvent('input', { bubbles: true }))
      return
    }
    // 用原生 setter 赋值，确保 React/Vue 等受控组件能感知到值的变化
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')
    if (setter && setter.set) setter.set.call(el, '')
    else el.value = ''
    el.dispatchEvent(new Event('input', { bubbles: true }))
  }

  // 每打一个字前的随机延迟（250~500ms），避免过快触发风控
  function charDelay() {
    return 250 + Math.random() * 250
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  // 逐字依次填入；返回是否全部填入
  async function pasteCharByChar(value) {
    const start = document.activeElement
    if (!isEditable(start)) return false
    const chars = Array.from(value)
    const boxes = findCharBoxes(start)
    // 找到多个单字符框时按顺序逐字填入，否则退化为整段填入起始框
    const targets = boxes.length >= chars.length ? boxes.slice(0, chars.length) : [start]
    if (targets.length === 1) return insertText(start, value)

    // 先清空所有目标输入框，避免残留旧内容
    for (const el of targets) clearElement(el)

    // 逐字填入：每个框重新聚焦后插入一个字符，字与字之间随机延迟；toast 显示进度（paste-toast.html 逐字帧）
    for (let i = 0; i < chars.length; i++) {
      const el = targets[i]
      await sleep(charDelay())
      el.focus()
      showToast('逐字粘贴中 ' + (i + 1) + ' / ' + chars.length, 'progress')
      if (!insertText(el, chars[i])) return false
    }
    return true
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || typeof msg.type !== 'string') return

    if (msg.type === 'kdocs-fetcher-ping') {
      sendResponse({ ok: true })
      return
    }

    if (msg.type === 'kdocs-fetcher-paste-start') {
      startProgress()
      return
    }

    if (msg.type === 'kdocs-fetcher-paste-error') {
      stopProgress()
      showToast('获取失败：' + (typeof msg.message === 'string' ? msg.message : '未知错误'), 'error')
      hideToast(4000)
      return
    }

    if (msg.type === 'kdocs-fetcher-paste') {
      stopProgress()
      const value = typeof msg.value === 'string' ? msg.value : ''
      if (!value) return
      showToast('获取中 100%，正在粘贴…', 'loading')
      awaitPaste(value, msg.charByChar === true)
      return
    }
  })

  // 逐字粘贴是异步的，结果回来后统一用气泡反馈；成功文案带数据摘要
  async function awaitPaste(value, charByChar) {
    let ok = false
    try {
      ok = charByChar ? await pasteCharByChar(value) : pasteValue(value)
    } catch (_) {
      ok = false
    }
    if (ok) {
      showToast((charByChar ? '已逐字粘贴 · ' : '已粘贴最新记录 · ') + previewOf(value), 'ok')
      hideToast(1500)
    } else {
      showToast('粘贴失败：请先点击输入框后再试', 'error')
      hideToast(4000)
    }
  }
})()
