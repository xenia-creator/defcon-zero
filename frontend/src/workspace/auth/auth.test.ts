import { describe, expect, it } from 'vitest'
import { cleanNationName, nationNameProblem } from './ClaimCountry'

describe('cleanNationName and nationNameProblem (docs/api.md section 3)', () => {
  it('trims leading/trailing spaces and collapses repeated spaces', () => {
    expect(cleanNationName('   Red    Fox   Republic  ')).toBe('Red Fox Republic')
    expect(cleanNationName('   ')).toBe('')
  })

  it('validates the cleaned name rather than the raw input', () => {
    // '  ab  ' cleans to 'ab' (2 chars), which must be rejected
    expect(nationNameProblem('  ab  ')).toBe('A nation name is 3 to 24 characters.')
    // '   ' cleans to ''
    expect(nationNameProblem('   ')).toBe('Choose a nation name.')
    // Must contain at least one letter (v4)
    expect(nationNameProblem('12345')).toBe('A nation name must include at least one letter.')
    expect(nationNameProblem('007')).toBe('A nation name must include at least one letter.')
    // Padded valid name passes once cleaned
    expect(nationNameProblem('  Red   Dawn  ')).toBeNull()
  })
})

