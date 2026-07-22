// Blurs the content body of the Pro screenshots (keeps sidebar nav + header strip
// sharp) so they show the Pro UI/feature set without exposing any real CRM data.
//   node scripts/blur-pro-shots.mjs
import sharp from 'sharp'
import { readdirSync } from 'fs'

const DIR = 'pro/docs/screenshots'
const SB = 256 // sidebar width (2x) — kept sharp (pro nav)
const HDR = 120 // header strip height (2x) — kept sharp (screen title)

for (const f of readdirSync(DIR).filter((f) => f.endsWith('.png'))) {
  const p = `${DIR}/${f}`
  const m = await sharp(p).metadata()
  const region = { left: SB, top: HDR, width: m.width - SB, height: m.height - HDR }
  const blurred = await sharp(p).extract(region).blur(25).toBuffer()
  await sharp(p)
    .composite([{ input: blurred, left: SB, top: HDR }])
    .toFile(`/tmp/blur-${f}`)
  console.log('✓', f)
}
console.log('done → /tmp/blur-*.png (review before overwriting originals)')
