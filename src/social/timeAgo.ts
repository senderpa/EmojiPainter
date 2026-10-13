/** Relative "x ago" formatting for unix-second timestamps (shared by feed cards). */
export function timeAgo(unixSec: number): string {
  if (!unixSec) return '';
  const now = Math.floor(Date.now() / 1000);
  const d = Math.max(0, now - unixSec);
  if (d < 60) return 'just now';
  if (d < 3600) return `${Math.floor(d / 60)}m ago`;
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`;
  if (d < 604800) return `${Math.floor(d / 86400)}d ago`;
  if (d < 2629800) return `${Math.floor(d / 604800)}w ago`;
  if (d < 31557600) return `${Math.floor(d / 2629800)}mo ago`;
  return `${Math.floor(d / 31557600)}y ago`;
}

/** Absolute, friendly date like "5 Dec 2025". */
export function shortDate(unixSec: number): string {
  if (!unixSec) return '';
  const d = new Date(unixSec * 1000);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
}
