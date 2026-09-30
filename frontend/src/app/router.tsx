import { createBrowserRouter } from "react-router";
import { appRoutes } from "./routes";

/** The app's addresses, as the browser shows them. A view-only copy uses its own (after a #). */
export const router = createBrowserRouter(appRoutes);
