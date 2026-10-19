import { describe, expect, it } from 'vitest'
import { fontGainDb, playedProgram } from '../web/viewer/fontGain'

describe('fontGain', () => {
  it('leaves the basic font alone', () => {
    expect(fontGainDb('basic', 29, false)).toBe(0)
    expect(fontGainDb('basic', 0, true)).toBe(0)
  })
  it('lifts the quiet MuseScore guitar and tames its drums', () => {
    expect(fontGainDb('musescore', 29, false)).toBeCloseTo(11.7, 1)
    expect(fontGainDb('musescore', 0, true)).toBeCloseTo(-7, 1)
  })
  it('brings FluidR3 down where it is louder', () => {
    expect(fontGainDb('fluid', 29, false)).toBeCloseTo(-4.2, 1)
  })
  it('clamps large corrections', () => {
    expect(fontGainDb('musescore', 88, false)).toBe(12)
  })
  it('uses the nearest measured program of the same family', () => {
    expect(fontGainDb('fluid', 26, false)).toBeCloseTo(-2, 1)
  })
  it('plays MuseScore acoustic pianos as Electric Grand', () => {
    expect(playedProgram('musescore', 0)).toBe(2)
    expect(playedProgram('musescore', 1)).toBe(2)
    expect(playedProgram('musescore', 29)).toBe(29)
    expect(playedProgram('fluid', 0)).toBe(0)
  })
})
