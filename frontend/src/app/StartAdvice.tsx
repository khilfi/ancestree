import { useDesktopUpdate } from "@/api/desktop";

/** What to do when the app can't reach its server. The desktop app's pages come from its own
 *  engine, so there it means opening the app again; in a browser, starting the server. */
export function StartAdvice() {
  const desktop = useDesktopUpdate().data;
  return desktop ? (
    <>Quit AncesTree from its icon by the clock, then open it again.</>
  ) : (
    <>
      Is the backend running? Start it with <code>scripts\dev.ps1</code>.
    </>
  );
}
