import { describe, it, expect } from 'vitest';
import { parseEuropeanAmount, parseDate, splitCSVRow, detectDelimiter, parseCSV } from '../lib/csv.js';

describe('parseEuropeanAmount', () => {
  it('parses European format (comma as decimal)', () => {
    expect(parseEuropeanAmount('17,99')).toBe(17.99);
  });

  it('parses format with thousands separator (1.234,56)', () => {
    expect(parseEuropeanAmount('1.234,56')).toBe(1234.56);
  });

  it('parses plain integer', () => {
    expect(parseEuropeanAmount('85')).toBe(85);
  });

  it('parses dot as decimal (international format)', () => {
    expect(parseEuropeanAmount('10.99')).toBe(10.99);
  });

  it('strips surrounding quotes', () => {
    expect(parseEuropeanAmount('"29,95"')).toBe(29.95);
  });

  it('returns null for empty string', () => {
    expect(parseEuropeanAmount('')).toBeNull();
  });

  it('returns null for non-numeric input', () => {
    expect(parseEuropeanAmount('abc')).toBeNull();
  });
});

describe('parseDate', () => {
  it('parses dd-mm-yyyy', () => {
    expect(parseDate('25-01-2024')).toBe('2024-01-25');
  });

  it('parses dd.mm.yyyy', () => {
    expect(parseDate('25.01.2024')).toBe('2024-01-25');
  });

  it('parses dd/mm/yyyy', () => {
    expect(parseDate('25/01/2024')).toBe('2024-01-25');
  });

  it('parses yyyy-mm-dd (ISO)', () => {
    expect(parseDate('2024-01-25')).toBe('2024-01-25');
  });

  it('parses yyyymmdd (compact)', () => {
    expect(parseDate('20240125')).toBe('2024-01-25');
  });

  it('returns null for empty input', () => {
    expect(parseDate('')).toBeNull();
  });

  it('returns null for unrecognized format', () => {
    expect(parseDate('januari 2024')).toBeNull();
  });
});

describe('splitCSVRow', () => {
  it('splits comma-separated values', () => {
    expect(splitCSVRow('a,b,c', ',')).toEqual(['a', 'b', 'c']);
  });

  it('splits semicolon-separated values', () => {
    expect(splitCSVRow('a;b;c', ';')).toEqual(['a', 'b', 'c']);
  });

  it('handles quoted values containing delimiter', () => {
    expect(splitCSVRow('"hello, world",b,c', ',')).toEqual(['hello, world', 'b', 'c']);
  });

  it('handles escaped quotes inside quoted value', () => {
    expect(splitCSVRow('"say ""hi""",b', ',')).toEqual(['say "hi"', 'b']);
  });

  it('trims whitespace around values', () => {
    expect(splitCSVRow(' a , b , c ', ',')).toEqual(['a', 'b', 'c']);
  });
});

describe('detectDelimiter', () => {
  it('detects semicolon', () => {
    expect(detectDelimiter('datum;bedrag;omschrijving\n25-01-2024;17,99;Netflix')).toBe(';');
  });

  it('detects comma', () => {
    expect(detectDelimiter('date,amount,description\n2024-01-25,17.99,Netflix')).toBe(',');
  });

  it('detects tab', () => {
    expect(detectDelimiter('datum\tbedrag\tomschrijving')).toBe('\t');
  });
});

describe('parseCSV', () => {
  it('parses a simple semicolon CSV', () => {
    const csv = 'naam;bedrag\nNetflix;17,99\nSpotify;10,99';
    const rows = parseCSV(csv);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ naam: 'Netflix', bedrag: '17,99' });
    expect(rows[1]).toEqual({ naam: 'Spotify', bedrag: '10,99' });
  });

  it('normalizes header keys to lowercase', () => {
    const csv = 'Naam;Bedrag\nNetflix;17,99';
    const rows = parseCSV(csv);
    expect(rows[0]).toHaveProperty('naam');
    expect(rows[0]).toHaveProperty('bedrag');
  });

  it('skips rows with fewer than 2 columns', () => {
    const csv = 'naam;bedrag\nNetflix;17,99\n\nSpotify;10,99';
    const rows = parseCSV(csv);
    expect(rows).toHaveLength(2);
  });
});
