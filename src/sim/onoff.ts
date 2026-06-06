/**
 * On/off (bang-bang) controller with a hysteresis band Δ — the thermostat.
 *
 *   u = uOn   when y < r − Δ/2
 *   u = uOff  when y > r + Δ/2
 *   hold      inside the band
 *
 * Nonlinear, so no C(s): the closed loop settles into a limit cycle whose
 * amplitude ≈ Δ (plus actuator-lag overshoot) and whose period follows from
 * the plant's rise/fall rates — predicted live in the theory panel.
 */
export class OnOffController {
  uOn = 100
  uOff = 0
  private on = false

  reset() {
    this.on = false
  }

  update(setpoint: number, y: number, band: number): number {
    if (y < setpoint - band / 2) this.on = true
    else if (y > setpoint + band / 2) this.on = false
    return this.on ? this.uOn : this.uOff
  }
}
