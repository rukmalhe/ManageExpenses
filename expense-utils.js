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
