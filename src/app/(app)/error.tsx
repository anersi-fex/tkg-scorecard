"use client";

import { useEffect } from "react";
import { EmptyState } from "@/components/ui/kit";

/**
 * What a page shows when it fails to load (the database is slow or down): a themed one-liner inside
 * the app's frame, with a button to ask again. Never prints the error's message or digest, which
 * can name a table or hold a value; the log gets the error's class only.
 */
export default function AppError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error("page_failed", error.name || "error");
  }, [error]);
  return (
    <div className="page-narrow" role="alert" data-app-error>
      <EmptyState
        icon="alert"
        title="Scorecard isn't answering."
        body="Try again in a minute."
        action={
          <button type="button" className="btn btn-primary" onClick={() => retry()}>
            Try again
          </button>
        }
      />
    </div>
  );
}
