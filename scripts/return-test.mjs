// Repro hunt: "go to later tabs, come back to the first ones — stuff in the
// visualization doesn't reset." Reads the dev __engine hook directly.
import { chromium } from 'playwright'

const b = await chromium.launch({ channel: 'chrome', headless: true })
const p = await b.newPage({ viewport: { width: 1600, height: 900 } })
const errs = []
p.on('pageerror', (e) => errs.push(e.message))

const engineState = () =>
  p.evaluate(() => {
    const e = window.__engine
    return {
      scn: e.scn?.id,
      t: +e.t.toFixed(3),
      x: e.x.map((v) => +v.toFixed(4)),
      histLen: e.history.t.length,
      histT0: e.history.t[0] ? +e.history.t[0].toFixed(3) : null,
      u: +e.u.toFixed(2),
    }
  })
const activeTab = () =>
  p.evaluate(
    () =>
      [...document.querySelectorAll('button')].find(
        (el) => el.className.includes('bg-sky-600') && ['Diagram', 'L = C·G', 'T, S', 'C anatomy', 'G'].includes(el.textContent),
      )?.textContent ?? '?',
  )

const nav = async (re) => {
  await p.getByRole('button', { name: re }).first().click()
  await p.waitForTimeout(400)
}

await p.goto('http://localhost:5174/?scenario=tank')
await p.waitForTimeout(3000)
console.log('tank fresh 3s:', JSON.stringify(await engineState()), 'tab:', await activeTab())

// park on a "later" Bode tab, visit later scenarios, come back
await p.getByRole('button', { name: 'G', exact: true }).click()
await nav(/PMSM torque/)
await p.waitForTimeout(2000)
console.log('pmsm-torque 2s:', JSON.stringify(await engineState()), 'tab:', await activeTab())
await nav(/Fighter/)
await p.waitForTimeout(2000)
console.log('jet 2s:       ', JSON.stringify(await engineState()), 'tab:', await activeTab())

await nav(/Water tank/)
await p.waitForTimeout(150)
console.log('tank return+0:', JSON.stringify(await engineState()), 'tab:', await activeTab())
await p.waitForTimeout(2000)
console.log('tank return+2:', JSON.stringify(await engineState()), 'tab:', await activeTab())

await nav(/Cruise/)
await p.waitForTimeout(300)
console.log('cruise +0.3:  ', JSON.stringify(await engineState()), 'tab:', await activeTab())

console.log('errors:', errs.length, errs.slice(0, 5))
await b.close()
