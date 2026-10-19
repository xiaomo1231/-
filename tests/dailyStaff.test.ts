import { describe, expect, it } from 'vitest'
import { dailyStaffNotes } from '../src/songs/dailyStaff'

const days = Array.from({ length: 98 }, (_, i) => ({
  day: i + 1,
  tempos: [40, 48, 56, 64],
}))

describe('dailyStaffNotes window', () => {
  it('shows the quarter that holds today', () => {
    expect(dailyStaffNotes({ today: 9, done: {}, bpm: {}, days }).firstWeek).toBe(1)
    expect(dailyStaffNotes({ today: 91, done: {}, bpm: {}, days }).firstWeek).toBe(1)
    expect(dailyStaffNotes({ today: 92, done: {}, bpm: {}, days }).firstWeek).toBe(14)
    expect(dailyStaffNotes({ today: 92, done: {}, bpm: {}, days }).weeks).toBe(13)
  })

  it('omits days before the quarter and after today', () => {
    const data = dailyStaffNotes({ today: 95, done: {}, bpm: {}, days })
    expect(data.notes.map((n) => n.day)).toEqual(Array.from({ length: 4 }, (_, i) => 92 + i))
    expect(data.notes.at(-1)!.kind).toBe('today')
  })

  it('gives week and weekday slot', () => {
    const data = dailyStaffNotes({ today: 10, done: {}, bpm: {}, days })
    const d9 = data.notes.find((n) => n.day === 9)!
    expect(d9.week).toBe(2)
    expect(d9.slot).toBe(1)
  })
})

describe('dailyStaffNotes kinds', () => {
  it('marks done, missed and today', () => {
    const data = dailyStaffNotes({
      today: 4,
      done: { '1': 1 },
      bpm: { '2': 56 },
      days,
    })
    const kinds = Object.fromEntries(data.notes.map((n) => [n.day, n.kind]))
    expect(kinds).toEqual({ 1: 'done', 2: 'done', 3: 'missed', 4: 'today' })
  })

  it('treats a bpm record alone as done', () => {
    const data = dailyStaffNotes({ today: 2, done: {}, bpm: { '1': 40 }, days })
    expect(data.notes[0]!.kind).toBe('done')
    expect(data.notes[0]!.bpm).toBe(40)
  })

  it('today counts as done once marked', () => {
    const data = dailyStaffNotes({ today: 2, done: { '2': 1 }, bpm: {}, days })
    expect(data.notes.at(-1)!.kind).toBe('done')
  })
})

describe('dailyStaffNotes heights', () => {
  it('maps bpm onto the tempo ladder of that day', () => {
    const data = dailyStaffNotes({
      today: 3,
      done: { '1': 1, '2': 1 },
      bpm: { '1': 40, '2': 60 },
      days,
    })
    expect(data.notes[0]!.height).toBe(0)
    expect(data.notes[1]!.height).toBeCloseTo(20 / 24, 6)
  })

  it('clamps bpm outside the ladder', () => {
    const data = dailyStaffNotes({
      today: 2,
      done: { '1': 1 },
      bpm: { '1': 200 },
      days,
    })
    expect(data.notes[0]!.height).toBe(1)
  })

  it('uses 0.5 for done without a bpm, and 0 for missed and today', () => {
    const data = dailyStaffNotes({ today: 3, done: { '1': 1 }, bpm: {}, days })
    expect(data.notes[0]!.height).toBe(0.5)
    expect(data.notes[1]!.kind).toBe('missed')
    expect(data.notes[1]!.height).toBe(0)
    expect(data.notes[2]!.height).toBe(0)
  })
})
