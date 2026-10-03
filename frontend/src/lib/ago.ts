/** "just now", "3 minutes ago", "2 hours ago", or the day: when something last happened. */
export function ago(iso: string, now: number = Date.now()): string {
  const seconds = (now - new Date(iso).getTime()) / 1000;
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.round(seconds / 60)} minute${seconds < 90 ? "" : "s"} ago`;
  if (seconds < 86_400) return `${Math.round(seconds / 3600)} hour${seconds < 5400 ? "" : "s"} ago`;
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}
