import { describe, it, expect } from 'vitest';
import { autoMatch } from '../lib/automatch.js';

const periode = { start_datum: '2024-01-25' };

const lasten = [
  { id: 1, naam: 'Netflix',    bedrag: 17.99, iban_tegenrekening: 'NL91ABNA0417164300', omschrijving_patroon: '',        verwachte_dag: null },
  { id: 2, naam: 'Spotify',    bedrag: 10.99, iban_tegenrekening: '',                   omschrijving_patroon: 'spotify',  verwachte_dag: null },
  { id: 3, naam: 'Verzekering',bedrag: 85.00, iban_tegenrekening: '',                   omschrijving_patroon: '',         verwachte_dag: 3    },
  { id: 4, naam: 'Gym',        bedrag: 29.95, iban_tegenrekening: 'NL20INGB0001234567', omschrijving_patroon: '',         verwachte_dag: null },
  { id: 5, naam: 'Gym2',       bedrag: 29.50, iban_tegenrekening: 'NL20INGB0001234567', omschrijving_patroon: '',         verwachte_dag: null },
];

describe('autoMatch — bijschrijvingen', () => {
  it('returns null for a credit (bedrag > 0)', () => {
    expect(autoMatch({ bedrag: 17.99, tegenrekening: 'NL91ABNA0417164300', omschrijving: '', datum: '2024-01-26' }, lasten, periode)).toBeNull();
  });

  it('returns null for bedrag === 0', () => {
    expect(autoMatch({ bedrag: 0, tegenrekening: '', omschrijving: 'spotify betaling', datum: '2024-01-26' }, lasten, periode)).toBeNull();
  });
});

describe('autoMatch — IBAN matching', () => {
  it('matches on IBAN when exactly one last has that IBAN', () => {
    const t = { bedrag: -17.99, tegenrekening: 'NL91ABNA0417164300', omschrijving: '', datum: '2024-01-26' };
    expect(autoMatch(t, lasten, periode)).toBe(1);
  });

  it('ignores spaces in IBAN comparison', () => {
    const t = { bedrag: -17.99, tegenrekening: 'NL91 ABNA 0417 1643 00', omschrijving: '', datum: '2024-01-26' };
    expect(autoMatch(t, lasten, periode)).toBe(1);
  });

  it('picks by amount when multiple lasten share an IBAN', () => {
    const t = { bedrag: -29.95, tegenrekening: 'NL20INGB0001234567', omschrijving: '', datum: '2024-01-26' };
    expect(autoMatch(t, lasten, periode)).toBe(4);
  });

  it('falls back to first IBAN match when amount is ambiguous', () => {
    const t = { bedrag: -99.00, tegenrekening: 'NL20INGB0001234567', omschrijving: '', datum: '2024-01-26' };
    // No amount match → returns first in list (id 4)
    expect(autoMatch(t, lasten, periode)).toBe(4);
  });
});

describe('autoMatch — omschrijving patroon', () => {
  it('matches via case-insensitive regex', () => {
    const t = { bedrag: -10.99, tegenrekening: '', omschrijving: 'Spotify Premium betaling', datum: '2024-01-26' };
    expect(autoMatch(t, lasten, periode)).toBe(2);
  });

  it('falls back to plain text when pattern is not valid regex', () => {
    // '[jan' is an unclosed character class — invalid regex
    // plain text fallback searches for the literal pattern string in the omschrijving
    const specialLasten = [{ id: 9, naam: 'Test', bedrag: 5.00, iban_tegenrekening: '', omschrijving_patroon: '[jan', verwachte_dag: null }];
    const t = { bedrag: -5.00, tegenrekening: '', omschrijving: 'betaling [jan factuur', datum: '2024-01-26' };
    expect(autoMatch(t, specialLasten, periode)).toBe(9);
  });
});

describe('autoMatch — bedrag + verwachte dag', () => {
  it('matches when amount matches and date is within 5 days of expected', () => {
    // verwachte_dag 3 → expected 2024-02-03 (start is jan 25, so dag 3 is in feb)
    const t = { bedrag: -85.00, tegenrekening: '', omschrijving: '', datum: '2024-02-05' };
    expect(autoMatch(t, lasten, periode)).toBe(3);
  });

  it('does not match when date is more than 5 days off', () => {
    const t = { bedrag: -85.00, tegenrekening: '', omschrijving: '', datum: '2024-02-10' };
    expect(autoMatch(t, lasten, periode)).toBeNull();
  });

  it('does not match when amount differs by more than €0.02', () => {
    // Use 0.03 difference to avoid floating point edge cases near the 0.02 boundary
    const t = { bedrag: -85.03, tegenrekening: '', omschrijving: '', datum: '2024-02-05' };
    expect(autoMatch(t, lasten, periode)).toBeNull();
  });
});

describe('autoMatch — geen match', () => {
  it('returns null when nothing matches', () => {
    const t = { bedrag: -999.00, tegenrekening: 'NL00UNKN0000000000', omschrijving: 'onbekend', datum: '2024-01-26' };
    expect(autoMatch(t, lasten, periode)).toBeNull();
  });
});
