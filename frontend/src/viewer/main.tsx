/**
 * A copy's page: the app itself, built as a copy, with the family it carries in
 * place of the API. Addresses come after a #, so every page works when the file is opened
 * straight from the disk.
 */
import "@xyflow/react/dist/style.css";
import "@/index.css";

import { createRoot } from "react-dom/client";
import { createHashRouter } from "react-router";
import { z } from "zod";
import { Root } from "@/app/Root";
import { installCopy } from "./answers";
import { LockScreen } from "./LockScreen";
import { copyRoutes } from "./routes";
import { type CopySnapshot, openCopy, readSealed } from "./snapshot";

// The copy allows no eval (its Content-Security-Policy): zod's forms check without trying it,
// which the browser would report as a violation.
z.config({ jitless: true });

const element = document.getElementById("root");
if (!element) throw new Error("The copy's page has no #root element");
const root = createRoot(element);

function start(snapshot: CopySnapshot) {
  installCopy(snapshot);
  root.render(<Root router={createHashRouter(copyRoutes)} copy={snapshot.about} />);
}

function broken(message: string) {
  root.render(
    <div className="flex h-full items-center justify-center p-8 text-center text-stone-600">
      <p className="max-w-md">{message}</p>
    </div>,
  );
}

const sealed = readSealed();
if (!sealed) {
  broken("This copy's family isn't in it: the file may be damaged. Ask for a new copy.");
} else if (sealed.locked) {
  root.render(<LockScreen onOpen={async (password) => start(await openCopy(sealed, password))} />);
} else {
  openCopy(sealed)
    .then(start)
    .catch((error: unknown) =>
      broken(error instanceof Error ? error.message : "This copy couldn't be opened."),
    );
}
