import { Navigate, type RouteObject } from "react-router";
import { AppLayout } from "./AppLayout";
import { ErrorPage } from "./ErrorPage";

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
      {
        path: "sample",
        lazy: async () => ({ Component: (await import("@/features/tree/SamplePage")).SamplePage }),
      },
      // Spike S7: ways of placing married-in families, side by side. The app's alone.
      ...(import.meta.env.MODE === "viewer"
        ? []
        : [
            {
              path: "sample/families",
              lazy: async () => ({
                Component: (await import("@/features/tree/sideBySide/SideBySidePage"))
                  .SideBySidePage,
              }),
            },
          ]),
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
          { path: "me", element: <Navigate to="/settings/family#me" replace /> },
          { path: "families", element: <Navigate to="/settings/family#families" replace /> },
          {
            path: "family-folder",
            element: <Navigate to="/settings/family#family-folder" replace />,
          },
          {
            path: "missing",
            lazy: async () => ({
              Component: (await import("@/features/settings/MissingSection")).MissingSection,
            }),
          },
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
          // The guide's pages are the app's alone: written out for a copy's build, so its
          // one file never carries the guide, its pictures or Mermaid.
          ...(import.meta.env.MODE === "viewer"
            ? []
            : [
                {
                  path: "help",
                  lazy: async () => ({
                    Component: (await import("@/features/settings/HelpSection")).HelpSection,
                  }),
                },
              ]),
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
      // The Trash and What's missing moved into Settings; old links still arrive.
      { path: "trash", element: <Navigate to="/settings/trash" replace /> },
      { path: "missing", element: <Navigate to="/settings/missing" replace /> },
    ],
  },
];
