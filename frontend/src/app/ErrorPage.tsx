import { isRouteErrorResponse, useNavigate, useRouteError } from "react-router";
import { Button } from "@/components/ui/button";

/** Shown instead of a blank page when something breaks while drawing a page. */
export function ErrorPage() {
  const error = useRouteError();
  const navigate = useNavigate(); // the app's addresses, or a copy's after a #
  let detail = "Something unexpected happened.";
  if (isRouteErrorResponse(error)) detail = `${error.status} ${error.statusText}`;
  else if (error instanceof Error) detail = error.message;

  return (
    <div className="flex h-full items-center justify-center bg-background p-8">
      <div className="max-w-md space-y-3 rounded-xl border border-border bg-card p-6 shadow-sm">
        <h1 className="text-lg font-semibold">This page stopped working</h1>
        <p className="text-sm text-muted-foreground">
          Nothing was lost: everything saved so far is safe. Reloading usually helps.
        </p>
        <pre className="overflow-x-auto rounded bg-muted p-2 text-xs text-muted-foreground">
          {detail}
        </pre>
        <div className="flex gap-2">
          <Button onClick={() => window.location.reload()}>Reload</Button>
          <Button variant="ghost" onClick={() => navigate("/tree")}>
            Back to the tree
          </Button>
        </div>
      </div>
    </div>
  );
}
