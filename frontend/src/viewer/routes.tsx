import { Navigate, type RouteObject } from "react-router";
import { appRoutes } from "@/app/routes";

/** Pages a view-only copy leaves out: Settings and the made-up sample. */
const LEFT_OUT = new Set(["settings", "sample", "trash", "missing"]);

/** The app's own pages, less those; any other address leads to the tree. */
export const copyRoutes: RouteObject[] = appRoutes.map((route): RouteObject => {
  if (route.index) return route;
  return {
    ...route,
    children: [
      ...(route.children ?? []).filter((child) => !LEFT_OUT.has(child.path ?? "")),
      { path: "*", element: <Navigate to="/tree" replace /> },
    ],
  };
});
