"use client";

import { useEffect } from "react";
import { RETRY_MS } from "@/components/board/poll";

/**
 * The TV's first screen could not be built (the database was slow or down). Static text would sit
 * there until someone walked over, so this asks again by reloading the page every 15 seconds,
 * quietly: it also picks up a fix that was deployed in the meantime.
 */
export function Reconnecting() {
  useEffect(() => {
    const id = setInterval(() => window.location.reload(), RETRY_MS);
    return () => clearInterval(id);
  }, []);
  return (
    <p role="status" data-reconnecting className="text-[16px] text-fg-2">
      Reconnecting…
    </p>
  );
}
