export type VantageDay = {
  business_date: string;
  reported_alp: number;
  reported_policies: number;
  updated_at: string;
  metadata: { placed_premium?: number; producers?: { agent_id: string; name: string; premium: number; policies: number; placed: number }[] };
};

export function summarizeVantageDays(days: VantageDay[]) {
  const producers = new Map<string, { name: string; premium: number; policies: number; placed: number }>();
  for (const day of days) {
    for (const producer of day.metadata.producers ?? []) {
      const total = producers.get(producer.agent_id) ?? { name: producer.name, premium: 0, policies: 0, placed: 0 };
      total.premium += producer.premium;
      total.policies += producer.policies;
      total.placed += producer.placed;
      producers.set(producer.agent_id, total);
    }
  }
  return {
    premium: days.reduce((n, day) => n + Number(day.reported_alp), 0),
    policies: days.reduce((n, day) => n + Number(day.reported_policies), 0),
    placed: days.reduce((n, day) => n + Number(day.metadata.placed_premium ?? 0), 0),
    // Oldest day refresh makes a partially refreshed period visible honestly.
    updatedAt: days.map(day => day.updated_at).sort()[0],
    start: days.map(day => day.business_date).sort()[0],
    end: days.map(day => day.business_date).sort().at(-1),
    producers: [...producers.values()].sort((a, b) => b.premium - a.premium),
  };
}
