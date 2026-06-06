import { create } from 'zustand'
import type { SimParams } from '../sim/loop'

interface Store extends SimParams {
  set: (partial: Partial<SimParams>) => void
}

export const useStore = create<Store>((set) => ({
  running: true,
  timeScale: 10,
  setpoint: 1.0,
  // Sensible-but-imperfect defaults: stable, visibly underdamped, so the
  // user has something to improve.
  kp: 60,
  ki: 1.5,
  kd: 0,
  wf: 10,
  valve: 0.5,
  noiseSigma: 0,
  set: (partial) => set(partial),
}))
