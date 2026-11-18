import { describe, it, expect } from 'vitest';
import { expenditureThroughDate, monthlyEntries } from '../expense-utils.js';

describe('event expenditure through today', () => {
  it('includes the whole team and all past months but excludes future dates', () => {
    const data = { type: 'shared', expenses: {
      old: { date: '2025-01-01', amount: 100, paidBy: 'a' },
      today: { date: '2026-11-18', amount: 269, paidBy: 'b' },
      future: { date: '2026-11-19', amount: 999, paidBy: 'a' }
    } };
    expect(expenditureThroughDate(data, '2026-11-18')).toBe(369);
    expect(expenditureThroughDate({}, '2026-11-18')).toBe(0);
  });
  it('includes personal one-off and monthly payments across years through their due day', () => {
    const data = { type: 'personal', expenses: { one: { date: '2026-01-01', amount: 50 } }, recurring: {
      loan: { start: '2025-12', end: '2027-12', day: 20, amount: 100 },
      future: { start: '2027-01', end: '2027-12', day: 1, amount: 999 }
    } };
    expect(expenditureThroughDate(data, '2026-11-18')).toBe(1150);
    expect(expenditureThroughDate(data, '2026-11-20')).toBe(1250);
  });
  it('clamps monthly dates for leap years and stops at the schedule end', () => {
    const data = { type: 'personal', recurring: { loan: { start: '2024-01', end: '2024-02', day: 31, amount: 100 } } };
    expect(expenditureThroughDate(data, '2024-02-28')).toBe(100);
    expect(expenditureThroughDate(data, '2024-02-29')).toBe(200);
    expect(expenditureThroughDate(data, '2026-11-18')).toBe(200);
  });
  it('counts weekly and fortnightly dates inclusively without DST shifts', () => {
    const data = { type: 'personal', recurring: {
      weekly: { frequency: 'weekly', startDate: '2026-09-21', endDate: '2026-10-05', amount: 100 },
      fortnight: { frequency: 'fortnightly', startDate: '2026-09-21', endDate: '2026-11-30', amount: 250 }
    } };
    expect(expenditureThroughDate(data, '2026-09-20')).toBe(0);
    expect(expenditureThroughDate(data, '2026-09-21')).toBe(350);
    expect(expenditureThroughDate(data, '2026-10-05')).toBe(800);
    expect(expenditureThroughDate(data, '2026-11-18')).toBe(1550);
  });
  it('matches the monthly list totals through a partial month', () => {
    const data = { type: 'personal', expenses: { one: { date: '2026-02-03', amount: 123 } }, recurring: {
      monthly: { start: '2026-01', end: '2026-03', day: 31, amount: 199 },
      weekly: { frequency: 'weekly', startDate: '2026-01-02', endDate: '2026-03-22', amount: 37 },
      fortnight: { frequency: 'fortnightly', startDate: '2026-01-17', endDate: '2026-03-22', amount: 41 }
    } };
    const total = ['2026-01', '2026-02', '2026-03'].flatMap(month => monthlyEntries(data, month)).filter(([,e]) => e.date <= '2026-03-18').reduce((sum,[,e]) => sum+e.amount,0);
    expect(expenditureThroughDate(data, '2026-03-18')).toBe(total);
  });
  it('recalculates after editing or deleting expenses and deleting schedules', () => {
    const data = { type: 'personal', expenses: { one: { date: '2026-11-18', amount: 100 } }, recurring: { loan: { start: '2026-11', end: '2026-12', day: 1, amount: 200 } } };
    expect(expenditureThroughDate(data, '2026-11-18')).toBe(300);
    data.expenses.one.amount = 400;
    expect(expenditureThroughDate(data, '2026-11-18')).toBe(600);
    data.expenses.one.date = '2026-11-19';
    expect(expenditureThroughDate(data, '2026-11-18')).toBe(200);
    delete data.recurring.loan;
    expect(expenditureThroughDate(data, '2026-11-18')).toBe(0);
  });
});
