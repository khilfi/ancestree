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
      {
        // Sections with their own addresses; /settings opens the first.
        path: "settings",
        lazy: async () => ({
          Component: (await import("@/features/settings/SettingsPage")).SettingsPage,
        }),
        children: [
          { index: true, element: <Navigate to="kinship" replace /> },
          {
            path: "kinship",
            lazy: async () => ({
              Component: (await import("@/features/settings/KinshipSection")).KinshipSection,
            }),
          },
          {
            path: "me",
            lazy: async () => ({
              Component: (await import("@/features/settings/MeSection")).MeSection,
            }),
          },
          {
            path: "kinds",
            lazy: async () => ({
              Component: (await import("@/features/settings/KindsSection")).KindsSection,
            }),
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
            path: "families",
            lazy: async () => ({
              Component: (await import("@/features/settings/FamiliesSection")).FamiliesSection,
            }),
          },
          {
            path: "family-folder",
            lazy: async () => ({
              Component: (await import("@/features/settings/FamilyFolderSection"))
                .FamilyFolderSection,
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
          {
            path: "about",
            lazy: async () => ({
              Component: (await import("@/features/settings/AboutSection")).AboutSection,
            }),
          },
        ],
      },
      // The Trash and What's missing moved into Settings; old links still arrive.
      { path: "trash", element: <Navigate to="/settings/trash" replace /> },
      { path: "missing", element: <Navigate to="/settings/missing" replace /> },
    ],
  },
];
