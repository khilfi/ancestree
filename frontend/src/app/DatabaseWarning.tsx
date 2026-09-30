import { TriangleAlertIcon } from "lucide-react";
import { Link } from "react-router";
import { useHealth } from "@/api/queries";

/** Can the app reach its server and the database? Checked every 15 seconds. */
export function useDatabaseDown(): boolean {
  const health = useHealth();
  return health.isError || health.data?.database === "down";
}

/** Only when something's wrong: too important to leave in Settings → About. */
export function DatabaseWarning() {
  const down = useDatabaseDown();
  if (!down) return null;
  return (
    <Link
      to="/settings/about"
      role="alert"
      className="flex items-center gap-1.5 rounded-md bg-red-50 px-2 py-1 text-sm font-medium text-red-700 hover:bg-red-100"
    >
      <TriangleAlertIcon className="size-4" />
      Can't reach the database
    </Link>
  );
}
