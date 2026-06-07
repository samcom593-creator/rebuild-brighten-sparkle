type NotificationLike = Record<string, unknown>;

const NOISE_PATTERNS = [
  /\btimeout\b/i,
  /statement timeout/i,
  /untitled suggestion/i,
  /apex standard digest failed/i,
  /standard digest failed/i,
  /stripe_secret_key not configured/i,
  /stripe sync failed/i,
  /stripe webhook/i,
  /stripe.*not configured/i,
  /webhook.*silent/i,
  /integration noise/i,
];

export function notificationSearchText(row: NotificationLike): string {
  return [
    row.title,
    row.subject,
    row.body,
    row.message,
    row.error_message,
    row.notification_type,
    row.type,
  ]
    .filter(Boolean)
    .map(String)
    .join(" ");
}

export function isActionableNotification(row: NotificationLike): boolean {
  const text = notificationSearchText(row);
  return !NOISE_PATTERNS.some((pattern) => pattern.test(text));
}

export function filterActionableNotifications<T extends NotificationLike>(rows: T[] | null | undefined): T[] {
  return (rows ?? []).filter(isActionableNotification);
}
