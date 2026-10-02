import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { type createBrowserRouter, RouterProvider } from "react-router";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { type CopyAbout, CopyProvider } from "./copy";

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 1 } },
});

/** Everything around the pages, for the app (main.tsx) and a copy (viewer/main.tsx), which
 *  says what copy it is. */
export function Root({
  router,
  copy = null,
}: {
  router: ReturnType<typeof createBrowserRouter>;
  copy?: CopyAbout | null;
}) {
  return (
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <CopyProvider value={copy}>
          <TooltipProvider>
            <RouterProvider router={router} />
            <Toaster theme="light" position="bottom-right" closeButton />
          </TooltipProvider>
        </CopyProvider>
      </QueryClientProvider>
    </StrictMode>
  );
}
