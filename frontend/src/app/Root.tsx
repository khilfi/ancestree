import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { type createBrowserRouter, RouterProvider } from "react-router";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { type CopyAbout, type CopyControls, CopyControlsProvider, CopyProvider } from "./copy";

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 1 } },
});

/** Everything around the pages, for the app (main.tsx) and a copy (viewer/main.tsx), which
 *  says what copy it is, and, when it's a copy to edit, how to save it. */
export function Root({
  router,
  copy = null,
  controls = null,
}: {
  router: ReturnType<typeof createBrowserRouter>;
  copy?: CopyAbout | null;
  controls?: CopyControls | null;
}) {
  return (
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <CopyProvider value={copy}>
          <CopyControlsProvider value={controls}>
            <TooltipProvider>
              <RouterProvider router={router} />
              <Toaster theme="light" position="bottom-right" closeButton />
            </TooltipProvider>
          </CopyControlsProvider>
        </CopyProvider>
      </QueryClientProvider>
    </StrictMode>
  );
}
