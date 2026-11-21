import { useEffect } from "react";
import { Navigate, type RouteObject } from "react-router";
import { openFamilyFacts } from "@/lib/familyFacts";
import { AppLayout } from "./AppLayout";
import { ErrorPage } from "./ErrorPage";

/** What's missing's old addresses, from when it was Settings': the tree, with Family
 *  facts open at What's missing. */
function WhatsMissing() {
  useEffect(() => openFamilyFacts("missing"), []);
  return <Navigate to="/tree" replace />;
}

// Views load on demand: the tree canvas (React Flow) is the heaviest part of the app. The app
// and a view-only copy share these pages (src/viewer/routes.tsx leaves some out).
export const appRoutes: RouteObject[] = [
  {
    path: "/",
    element: <AppLayout />,
    errorElement: <ErrorPage />,
    children: [
      { index: true, element: <Navigate to="/tree" replace /> },
      {
        path: "tree",
        lazy: async () => ({ Component: (await import("@/features/tree/TreePage")).TreePage }),
      },
      {
        path: "timeline",
        lazy: async () => ({
          Component: (await import("@/features/timeline/TimelinePage")).TimelinePage,
        }),
      },
      {
        path: "map",
        lazy: async () => ({ Component: (await import("@/features/map/MapPage")).MapPage }),
      },
      {
        path: "dictionary",
        lazy: async () => ({
          Component: (await import("@/features/dictionary/DictionaryPage")).DictionaryPage,
        }),
      },
      // The test pages, only in a development build, Vite's own: never in a release,
      // nor in a copy. The made-up family of 2,000 at size; and spike S7's ways of placing
      // married-in families, side by side.
      ...(import.meta.env.DEV
        ? [
            {
              path: "sample",
              lazy: async () => ({
                Component: (await import("@/features/tree/SamplePage")).SamplePage,
              }),
            },
            {
              path: "sample/families",
              lazy: async () => ({
                Component: (await import("@/features/tree/sideBySide/SideBySidePage"))
                  .SideBySidePage,
              }),
            },
          ]
        : []),
      {
        // Sections with their own addresses; /settings opens the first.
        path: "settings",
        lazy: async () => ({
          Component: (await import("@/features/settings/SettingsPage")).SettingsPage,
        }),
        children: [
          { index: true, element: <Navigate to="kinship" replace /> },
          // Kinship, and You and your family, each of several parts.
          {
            path: "kinship",
            lazy: async () => ({
              Component: (await import("@/features/settings/KinshipPage")).KinshipPage,
            }),
          },
          {
            path: "family",
            lazy: async () => ({
              Component: (await import("@/features/settings/FamilyPage")).FamilyPage,
            }),
          },
          // Their parts' old addresses lead to them, so every link and How does this work? lands.
          { path: "kinds", element: <Navigate to="/settings/kinship#kinds" replace /> },
          { path: "families", element: <Navigate to="/settings/family#families" replace /> },
          {
            path: "family-folder",
            element: <Navigate to="/settings/family#family-folder" replace />,
          },
          // Me is in its own menu, at the top right, since 0.9.0: its old part's address
          // opens the page it was on.
          { path: "me", element: <Navigate to="/settings/family" replace /> },
          // What's missing is Family facts' second tab since 0.9.0.
          { path: "missing", element: <WhatsMissing /> },
          {
            path: "import",
            lazy: async () => ({
              Component: (await import("@/features/settings/ImportSection")).ImportSection,
            }),
          },
          {
            path: "map",
            lazy: async () => ({
              Component: (await import("@/features/settings/MapSection")).MapSection,
            }),
          },
          {
            path: "backups",
            lazy: async () => ({
              Component: (await import("@/features/settings/BackupsSection")).BackupsSection,
            }),
          },
          {
            path: "trash",
            lazy: async () => ({
              Component: (await import("@/features/settings/TrashSection")).TrashSection,
            }),
          },
          // Help, a link to the guide since 0.9.0, as it repeated the guide: its old
          // address opens the guide.
          { path: "help", element: <Navigate to="/guide" replace /> },
          {
            path: "about",
            lazy: async () => ({
              Component: (await import("@/features/settings/AboutSection")).AboutSection,
            }),
          },
        ],
      },
      // The user guide, at /guide#<a heading's address>, as on GitHub.
      ...(import.meta.env.MODE === "viewer"
        ? []
        : [
            {
              path: "guide",
              lazy: async () => ({
                Component: (await import("@/features/guide/GuidePage")).GuidePage,
              }),
            },
          ]),
      // The Trash moved into Settings, and What's missing into Family facts; old
      // links still arrive.
      { path: "trash", element: <Navigate to="/settings/trash" replace /> },
      { path: "missing", element: <WhatsMissing /> },
    ],
  },
];
