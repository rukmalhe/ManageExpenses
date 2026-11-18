import { describe, it, expect } from 'vitest';
import { parseExpenseAmount } from '../expense-utils.js';

describe('amount additions', () => {
  it('calculates the requested expression in cents', () => {
    expect(parseExpenseAmount('24.69+5671+20967')).toBe(2666269);
  });
  it('adds decimal amounts and rejects invalid decimal characters', () => {
    expect(parseExpenseAmount('24.69+56.71+209.67')).toBe(29107);
    expect(() => parseExpenseAmount('24.x9+22.11')).toThrow('Use positive amounts with up to two decimal places');
  });
  it('avoids floating point rounding and supports spaces and decimal-only terms', () => {
    expect(parseExpenseAmount(' 0.10 + .20 + 24.69 ')).toBe(2499);
    expect(parseExpenseAmount('42')).toBe(4200);
    expect(parseExpenseAmount('0.01')).toBe(1);
    expect(parseExpenseAmount('999999.99+.01')).toBe(100000000);
  });
  it.each(['', '0', '0+0', '1+', '+1', '1++2', '1-2', '-1', '1*2', '1/2', '1e3', '1,000', '1.234', 'NaN', 'Infinity', 'alert(1)', '1000000+.01', '9999999999999999999', '1 2'])('rejects invalid or excessive input: %s', value => {
    expect(() => parseExpenseAmount(value)).toThrow();
  });
});
