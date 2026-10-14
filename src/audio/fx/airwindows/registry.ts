/**
 * Every ported Airwindows effect by name (the worklet and the tests look
 * them up here). Adding a port = one import + one entry.
 */
import type { AirwindowsInfo } from './types'
import { ADClip8 } from './ADClip8'
import { ButterComp2 } from './ButterComp2'
import { ClipOnly2 } from './ClipOnly2'
import { DeBess } from './DeBess'
import { Galactic3 } from './Galactic3'
import { kPlateD } from './kPlateD'
import { Pressure4 } from './Pressure4'
import { ToTape6 } from './ToTape6'
import { Tube2 } from './Tube2'
import { Verbity2 } from './Verbity2'

export const AIRWINDOWS = {
  ADClip8,
  ButterComp2,
  ClipOnly2,
  DeBess,
  Galactic3,
  kPlateD,
  Pressure4,
  ToTape6,
  Tube2,
  Verbity2,
} satisfies Record<string, AirwindowsInfo>

export type AirwindowsName = keyof typeof AIRWINDOWS
