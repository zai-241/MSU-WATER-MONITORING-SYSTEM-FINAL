/** Short "time ago" labels for the dashboard (kept out of Dashboard.tsx so it only exports components). */
export const formatRelativeTime = (secs: number) => {
  if (secs < 5) return 'just now';
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  return 'more than an hour ago';
};

export const formatLastSeen = (timestamp?: number, currentServerTime?: number) => {
  if (!timestamp) return 'Never';
  const now = currentServerTime ?? Date.now();
  const diffSecs = Math.max(0, Math.floor((now - timestamp) / 1000));
  if (diffSecs < 5) return 'just now';
  if (diffSecs < 60) return `${diffSecs}s ago`;
  const mins = Math.floor(diffSecs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(timestamp).toLocaleDateString();
};
