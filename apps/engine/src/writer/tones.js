// Default tone profile (Phase 4 brief, 6.4).

export const DEFAULT_TONES = Object.freeze({
  'friendly-teacher': Object.freeze([
    'Explains like a patient teacher talking to a smart 10-year-old.',
    'Short, plain sentences; common words; one idea per sentence.',
    'Direct: says the answer first, then explains why or how.',
    'Calm and helpful; no hype, no jokes, no exclamation marks, no hooks.',
    'Uses "you" for the reader; never "we" for M91\'s own experiences.',
    'Explains each technical word right where it first appears, in a few plain words.'
  ])
})

/** Notes for a default tone id (falls back to friendly-teacher). */
export const defaultToneNotes = (id) => DEFAULT_TONES[id] ?? DEFAULT_TONES['friendly-teacher']
