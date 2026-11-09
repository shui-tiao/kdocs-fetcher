// 主题偏好：light / dark / auto（跟随系统）。所有扩展页面共用，配置页可切换。
// 先同步按系统偏好着色避免首帧闪白，再读取本地设置校正；随后监听设置与系统变化。
;(() => {
  const root = document.documentElement
  const media = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null
  let mode = 'auto'

  function resolve(m) {
    if (m === 'light' || m === 'dark') return m
    return media && media.matches ? 'dark' : 'light'
  }

  function apply(m) {
    mode = m === 'light' || m === 'dark' ? m : 'auto'
    const theme = resolve(mode)
    root.dataset.theme = theme
    root.style.colorScheme = theme
  }

  apply('auto')

  if (window.chrome && chrome.storage && chrome.storage.local) {
    chrome.storage.local.get('theme', (cfg) => {
      if (cfg && cfg.theme) apply(cfg.theme)
    })
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes.theme) apply(changes.theme.newValue)
    })
  }

  if (media) {
    const onChange = () => { if (mode === 'auto') apply('auto') }
    if (media.addEventListener) media.addEventListener('change', onChange)
    else if (media.addListener) media.addListener(onChange)
  }
})()
