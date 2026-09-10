export function formatRelativeTime(isoDate: string | Date): string {
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) return '';

  const now = Date.now();
  const diffMs = Math.max(0, now - date.getTime());

  const diffMin = Math.floor(diffMs / 60_000);
  const diffHours = Math.floor(diffMs / 3_600_000);
  const diffDays = Math.floor(diffMs / 86_400_000);

  if (diffMin < 1) return 'now';
  if (diffMin < 60) return `${diffMin}min`;
  if (diffHours < 24) return `${diffHours}h`;
  if (diffDays < 7) return `${diffDays}d`;

  return date.toLocaleDateString('ar-SA', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}