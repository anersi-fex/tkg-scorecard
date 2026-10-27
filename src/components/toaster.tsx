"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/components/ui";

/**
 * A short message at the bottom of the screen after a tap ("Logged. The board is celebrating.").
 * It lives in the app layout, so it stays visible when the card that was tapped leaves the list.
 */
const EVENT = "sc-toast";

export function toast(text: string, ok = true): void {
  window.dispatchEvent(new CustomEvent(EVENT, { detail: { text, ok } }));
}

export function Toaster() {
  const [msg, setMsg] = useState<{ text: string; ok: boolean; id: number } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const onToast = (e: Event) => {
      const { text, ok } = (e as CustomEvent<{ text: string; ok: boolean }>).detail;
      if (!text) return;
      setMsg({ text, ok, id: Date.now() });
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setMsg(null), 4500);
    };
    window.addEventListener(EVENT, onToast);
    return () => {
      window.removeEventListener(EVENT, onToast);
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 z-40 flex justify-center px-4"
      style={{ bottom: "calc(var(--tabbar-h, 0px) + max(16px, env(safe-area-inset-bottom, 0px)) + 8px)" }}
    >
      {msg && (
        <p
          key={msg.id}
          role="status"
          className={cn(
            "pointer-events-auto max-w-md rounded-2xl px-4 py-3 text-[14px] leading-snug font-semibold shadow-float",
            msg.ok ? "bg-gray-900 text-ink" : "bg-danger text-white",
          )}
        >
          {msg.text}
        </p>
      )}
    </div>
  );
}
