export function page(q: { limit?: string | number; offset?: string | number }, max = 200): { take: number; skip: number } {
  const take = Math.min(Math.max(Number(q.limit ?? 50) || 50, 1), max);
  const skip = Math.max(Number(q.offset ?? 0) || 0, 0);
  return { take, skip };
}
