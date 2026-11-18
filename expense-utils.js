// Use UTC date-only arithmetic so weekly repeats remain stable through DST changes.
const dayMs = 86400000;
export function monthlyEntries(data, month) {
  const entries = Object.entries(data.expenses || {}).filter(([, e]) => e.date.startsWith(month));
  const first = Date.parse(`${month}-01T00:00:00Z`);
  const next = new Date(first); next.setUTCMonth(next.getUTCMonth() + 1);
  Object.entries(data.recurring || {}).forEach(([key, r]) => {
    const frequency = r.frequency || 'monthly';
    if (frequency === 'monthly') {
      if (month < r.start || month > r.end) return;
      const lastDay = new Date(next.getTime() - dayMs).getUTCDate();
      const date = `${month}-${String(Math.min(r.day, lastDay)).padStart(2, '0')}`;
      entries.push([`${key}:${date}`, { ...r, date, scheduled: true }]);
    } else {
      const start = Date.parse(`${r.startDate}T00:00:00Z`), end = Date.parse(`${r.endDate}T00:00:00Z`);
      const interval = (frequency === 'weekly' ? 7 : 14) * dayMs;
      if (!Number.isFinite(start) || !Number.isFinite(end)) return;
      for (let time = start + Math.max(0, Math.ceil((first-start)/interval))*interval; time < next.getTime() && time <= end; time += interval) {
        const date = new Date(time).toISOString().slice(0,10);
        entries.push([`${key}:${date}`, { ...r, date, scheduled: true }]);
      }
    }
  });
  return entries.sort((a,b) => b[1].date.localeCompare(a[1].date));
}
export function groupExpenses(entries) {
  const groups = new Map();
  for (const entry of entries) {
    const category = entry[1].category;
    if (!groups.has(category)) groups.set(category, { category, total: 0, entries: [] });
    const group = groups.get(category); group.total += entry[1].amount; group.entries.push(entry);
  }
  return [...groups.values()].sort((a,b) => a.category.localeCompare(b.category));
}

// Parse additions directly into integer cents; never execute user input as code.
export function parseExpenseAmount(expression) {
  const input = String(expression).trim();
  if (!input || input.length > 300) throw new Error('Enter an amount or add amounts with + (for example, 24.69+10).');
  let total = 0;
  for (const part of input.split('+')) {
    const term = part.trim();
    if (!/^(?:\d+(?:\.\d{1,2})?|\.\d{1,2})$/.test(term)) {
      throw new Error('Use positive amounts with up to two decimal places, separated by +.');
    }
    const [whole, fraction = ''] = term.split('.');
    total += Number(whole || '0') * 100 + Number(fraction.padEnd(2, '0'));
    if (!Number.isSafeInteger(total) || total > 100000000) throw new Error('The total cannot exceed 1,000,000.');
  }
  if (total <= 0) throw new Error('The total must be at least 0.01.');
  return total;
}

// Cumulative expenditure through an inclusive local date, calculated in cents.
// Count schedule occurrences arithmetically instead of generating every past row.
export function expenditureThroughDate(data, today) {
  let total = Object.values(data.expenses || {})
    .filter(expense => expense.date <= today)
    .reduce((sum, expense) => sum + expense.amount, 0);
  if (data.type !== 'personal') return total;
  const monthIndex = month => Number(month.slice(0,4)) * 12 + Number(month.slice(5,7)) - 1;
  for (const schedule of Object.values(data.recurring || {})) {
    let count = 0;
    if (!schedule.frequency || schedule.frequency === 'monthly') {
      const lastMonth = schedule.end < today.slice(0,7) ? schedule.end : today.slice(0,7);
      count = monthIndex(lastMonth) - monthIndex(schedule.start) + 1;
      if (count > 0 && lastMonth === today.slice(0,7)) {
        const lastDay = new Date(Date.UTC(Number(lastMonth.slice(0,4)), Number(lastMonth.slice(5,7)), 0)).getUTCDate();
        if (Math.min(schedule.day, lastDay) > Number(today.slice(8))) count--;
      }
    } else if (['weekly', 'fortnightly'].includes(schedule.frequency)) {
      const lastDate = schedule.endDate < today ? schedule.endDate : today;
      const days = (Date.parse(`${lastDate}T00:00:00Z`) - Date.parse(`${schedule.startDate}T00:00:00Z`)) / dayMs;
      count = Math.floor(days / (schedule.frequency === 'weekly' ? 7 : 14)) + 1;
    }
    total += Math.max(0, count) * schedule.amount;
  }
  return total;
}
