// 用官网品牌 SVG 生成扩展图标（16/32/48/128）
const path = require('path')
const sharp = require(path.join(process.env.TEMP, 'iconrender', 'node_modules', 'sharp'))

// 64x64 视口，取自 docs/index.html 的 .brand 图标
// 小尺寸下细线会糊，按尺寸微调线宽并去掉过细的分隔线
function svgFor(size) {
  const small = size <= 32
  const gridStroke = small ? 3.4 : 2.5
  const inner = small
    ? `<rect x="13" y="13" width="30" height="32" rx="3" fill="#fff"/>`
    : `<rect x="13" y="13" width="30" height="32" rx="3" fill="#fff"/>`
  const lines = small
    ? `<path d="M13 24h30M33 13v32" stroke="#2262E8" stroke-width="${gridStroke}"/>`
    : `<path d="M13 24h30M23 13v32M33 13v32" stroke="#2262E8" stroke-width="${gridStroke}"/>`
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="${size}" height="${size}">
    <rect width="64" height="64" rx="14" fill="#2262E8"/>
    ${inner}
    ${lines}
    <path d="M44 36l9 16H35z" fill="#6FB6F2"/>
  </svg>`
}

const outDir = path.resolve(__dirname, '..', 'extension', 'icons')

;(async () => {
  for (const size of [16, 32, 48, 128, 300]) {
    await sharp(Buffer.from(svgFor(size)))
      .resize(size, size)
      .png()
      .toFile(path.join(outDir, `icon${size}.png`))
    console.log('wrote icon' + size + '.png')
  }
})()
