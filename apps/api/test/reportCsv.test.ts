import { describe, expect, it } from 'vitest';

import {
  escapeCsvCell,
  toCsvString,
} from '../src/services/reportService.js';

describe('CSV generation & formula injection security tests', () => {
  it('escapes standard values and double quotes properly', () => {
    expect(escapeCsvCell('Simple text')).toBe('"Simple text"');
    expect(escapeCsvCell(null)).toBe('""');
    expect(escapeCsvCell(undefined)).toBe('""');
    expect(escapeCsvCell(1234.56)).toBe('"1234.56"');
    expect(escapeCsvCell('Text with "quotes" inside')).toBe('"Text with ""quotes"" inside"');
  });

  it('neutralizes formula injection attempts starting with =, +, @, %, \\t, \\r', () => {
    // Formula attacks starting with =
    expect(escapeCsvCell('=1+1')).toBe(`"'=1+1"`);
    expect(escapeCsvCell('=cmd|\' /C calc\'!A0')).toBe(`"'=cmd|' /C calc'!A0"`);

    // Formula attacks starting with +
    expect(escapeCsvCell('+1+2')).toBe(`"'+1+2"`);

    // Formula attacks starting with @
    expect(escapeCsvCell('@SUM(A1:A10)')).toBe(`"'@SUM(A1:A10)"`);

    // Attacks starting with %
    expect(escapeCsvCell('%OS%')).toBe(`"'%OS%"`);

    // Attacks starting with tabs or carriage returns
    expect(escapeCsvCell('\t=calc')).toBe(`"'\t=calc"`);
    expect(escapeCsvCell('\r=calc')).toBe(`"'\r=calc"`);

    // Whitespace preceding dangerous formula
    expect(escapeCsvCell('   =SUM(A1:A10)')).toBe(`"'   =SUM(A1:A10)"`);
  });

  it('permits safe negative numbers while neutralizing negative formula attacks', () => {
    // Safe negative numbers (e.g. member balances or debtor amounts)
    expect(escapeCsvCell('-50.00')).toBe('"-50.00"');
    expect(escapeCsvCell('-1200')).toBe('"-1200"');
    expect(escapeCsvCell('-0.75')).toBe('"-0.75"');

    // Dangerous expressions starting with minus
    expect(escapeCsvCell('-2+5*cmd')).toBe(`"'-2+5*cmd"`);
    expect(escapeCsvCell('-cmd|\' /C calc\'!A0')).toBe(`"'-cmd|' /C calc'!A0"`);
  });

  it('generates properly formatted CRLF-separated CSV tables', () => {
    const headers = ['Category', 'Amount', 'Status'];
    const rows = [
      ['Food & Dining', '350.00', 'Active'],
      ['Shopping', '=2+2', 'Active'],
      ['Transport', '-45.00', 'Reversed'],
    ];

    const csv = toCsvString(headers, rows);
    const lines = csv.split('\r\n');
    expect(lines).toHaveLength(4);
    expect(lines[0]).toBe('"Category","Amount","Status"');
    expect(lines[1]).toBe('"Food & Dining","350.00","Active"');
    expect(lines[2]).toBe('"Shopping","\'=2+2","Active"');
    expect(lines[3]).toBe('"Transport","-45.00","Reversed"');
  });
});
