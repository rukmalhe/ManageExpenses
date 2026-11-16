import { describe, it, expect } from 'vitest';
import { monthlyEntries, groupExpenses } from '../expense-utils.js';
const recurring = (record, month) => monthlyEntries({ recurring: { loan: { description: 'Loan', category: 'Transport', amount: 1000, ...record } } }, month);

describe('recurring personal expenses', () => {
  it('preserves existing monthly schedules and clamps month-end dates in leap years', () => {
    expect(recurring({ start: '2024-01', end: '2024-03', day: 31 }, '2024-02').map(([,e])=>e.date)).toEqual(['2024-02-29']);
    expect(recurring({ start: '2024-01', end: '2024-03', day: 31 }, '2024-04')).toEqual([]);
  });
  it('lists every weekly payment in a month with inclusive start and end dates', () => {
    const entries = recurring({ frequency: 'weekly', startDate: '2026-10-26', endDate: '2026-11-16' }, '2026-11');
    expect(entries.map(([,e])=>e.date)).toEqual(['2026-11-16','2026-11-09','2026-11-02']);
    expect(new Set(entries.map(([key])=>key)).size).toBe(3);
  });
  it('keeps fortnightly payments anchored across months and DST', () => {
    expect(recurring({ frequency: 'fortnightly', startDate: '2026-09-21', endDate: '2026-11-30' }, '2026-10').map(([,e])=>e.date)).toEqual(['2026-10-19','2026-10-05']);
  });
  it('excludes schedules outside their timeline', () => {
    expect(recurring({ frequency: 'weekly', startDate: '2027-01-01', endDate: '2027-12-31' }, '2026-11')).toEqual([]);
  });
  it('groups one-off and recurring transport together and preserves totals', () => {
    const data = { expenses: { bus: { category: 'Transport', amount: 250, date: '2026-11-01' }, food: { category: 'Food', amount: 500, date: '2026-11-03' }, old: { category: 'Food', amount: 999, date: '2026-10-31' } }, recurring: { car: { category: 'Transport', description: 'Car', amount: 1000, start: '2026-01', end: '2026-12', day: 5 } } };
    const groups = groupExpenses(monthlyEntries(data,'2026-11'));
    expect(groups.map(g=>[g.category,g.total,g.entries.length])).toEqual([['Food',500,1],['Transport',1250,2]]);
  });
});
