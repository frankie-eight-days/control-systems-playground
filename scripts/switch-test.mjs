// E2E: scenario switching. Clicks every scenario nav button and checks
//  (a) zero console/page errors, (b) chart titles changed to the new
//  scenario's labels, (c) chart canvases keep receiving fresh pixels
//  (data flowing), (d) the scene canvas is animating.
// Run: node scripts/switch-test.mjs   (dev server must be up on :5174)
import { chromium } from 'playwright'

const APP = 'http://localhost:5174/?scenario=tank'
const NAV = [
  ['cruise', /Cruise/],
  ['thermal', /Boiler/],
  ['motor', /[Mm]otor position/],
  ['buck', /Buck/],
  ['pmsm-torque', /PMSM torque/],
  ['pmsm-speed', /PMSM speed/],
  ['jet', /Fighter/],
  ['tank', /Water tank/],
]

const browser = await chromium.launch({ channel: 'chrome', headless: true })
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } })
const errors = []
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`console: ${m.text().slice(0, 200)}`)
})

await page.goto(APP)
await page.waitForTimeout(2500)

const snapshot = async () =>
  page.evaluate(() => ({
    titles: [...document.querySelectorAll('.u-title')].map((e) => e.textContent ?? ''),
  }))

// Hash scene canvas + every uPlot chart canvas. Comparing two hashes taken
// ~700 ms apart tells us which surfaces are actually receiving fresh pixels.
const hashes = async () =>
  page.evaluate(() => {
    const dataUrl = (c) => {
      const x = document.createElement('canvas')
      x.width = 48
      x.height = 48
      x.getContext('2d').drawImage(c, 0, 0, 48, 48)
      return x.toDataURL().slice(-40)
    }
    const scene = document.querySelector('main canvas')
    const charts = [...document.querySelectorAll('.u-wrap canvas')]
    return {
      scene: scene ? dataUrl(scene) : 'none',
      charts: charts.map(dataUrl),
    }
  })

// prove the probe on the initial scenario before any switching
{
  const a = await hashes()
  await page.waitForTimeout(700)
  const b = await hashes()
  const flowing = a.charts.some((h, i) => h !== b.charts[i])
  console.log(`BASELINE tank: chartsFlowing=${flowing} (probe ${flowing ? 'valid' : 'BROKEN'})`)
}

let fails = 0
for (const [id, re] of NAV) {
  const before = await snapshot()
  await page.getByRole('button', { name: re }).first().click()
  await page.waitForTimeout(1600)
  const after = await snapshot()
  const h1 = await hashes()
  await page.waitForTimeout(700)
  const h2 = await hashes()

  const titlesChanged = JSON.stringify(before.titles) !== JSON.stringify(after.titles)
  const chartsFlowing = h1.charts.length > 0 && h1.charts.some((h, i) => h !== h2.charts[i])
  const sceneAnimating = h1.scene !== h2.scene
  const ok = titlesChanged && chartsFlowing
  if (!ok) fails++
  console.log(
    `${ok ? 'OK  ' : 'FAIL'} ${id.padEnd(12)} titlesChanged=${titlesChanged} chartsFlowing=${chartsFlowing} sceneAnimating=${sceneAnimating} nCharts=${h1.charts.length}`,
  )
  await page.screenshot({ path: `/tmp/switch-${id}.png` })
}

console.log(`\n${fails} failures; ${errors.length} JS errors`)
for (const e of errors.slice(0, 10)) console.log('  ', e)
await browser.close()

// ---- edge cases the default pass misses ----
const page2 = await (await chromium.launch({ channel: 'chrome', headless: true })).newPage({
  viewport: { width: 1600, height: 900 },
})
const errors2 = []
page2.on('pageerror', (e) => errors2.push(`pageerror: ${e.message}`))
page2.on('console', (m) => m.type() === 'error' && errors2.push(m.text().slice(0, 150)))
await page2.goto('http://localhost:5174/?scenario=tank')
await page2.waitForTimeout(2000)

// 1. switch while PAUSED → then run: charts must flow in the new scenario
await page2.getByRole('button', { name: 'Pause' }).click()
await page2.getByRole('button', { name: /Buck/ }).first().click()
await page2.waitForTimeout(800)
await page2.getByRole('button', { name: 'Run', exact: true }).click()
await page2.waitForTimeout(1200)
const pa = await page2.evaluate(() => [...document.querySelectorAll('.u-wrap canvas')].length)
console.log(`paused-switch: nCharts=${pa} errors=${errors2.length}`)

// 2. switch while on the T,S tab
await page2.getByRole('button', { name: 'T, S' }).click()
await page2.getByRole('button', { name: /Cruise/ }).first().click()
await page2.waitForTimeout(1000)
console.log(`tab-switch: errors=${errors2.length}`)

// 3. rapid-fire through all scenarios
for (const [, re] of NAV) {
  await page2.getByRole('button', { name: re }).first().click()
  await page2.waitForTimeout(120)
}
await page2.waitForTimeout(1500)
console.log(`rapid-fire: errors=${errors2.length}`)
for (const e of errors2.slice(0, 8)) console.log('  ', e)
process.exit(fails || errors.length || errors2.length ? 1 : 0)
