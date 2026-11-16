"use client";

import { useState, useSyncExternalStore } from "react";
import { Icon } from "@/components/ui/icon";
import { btn } from "@/components/ui/kit";
import s from "./link-box.module.css";

const noSubscribe = () => () => {};

/**
 * A link on screen with Copy (and Share where the phone has a share sheet). Shown on People (the
 * join cards) and on Home (the first-steps card): one piece, so the two read the same.
 */
export function LinkBox({ url, shareText, label }: { url: string; shareText: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const canShare = useSyncExternalStore(
    noSubscribe,
    () => typeof navigator !== "undefined" && typeof navigator.share === "function",
    () => false,
  );
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      window.prompt("Copy this link", url);
    }
  };
  return (
    <div data-link-box>
      <div className={s.linkRow}>
        <code aria-label={label} className={s.linkText}>
          {url}
        </code>
        <button type="button" className={btn("secondary", "sm")} onClick={copy}>
          <Icon name="copy" size={15} />
          <span>{copied ? "Copied" : "Copy"}</span>
        </button>
      </div>
      {canShare && (
        <button
          type="button"
          className={btn("ghost", "sm", "mt-2")}
          onClick={() => {
            // The person closing the share sheet is not an error.
            navigator.share({ title: "Scorecard", text: shareText, url }).catch(() => {});
          }}
        >
          <Icon name="send" size={15} />
          <span>Share</span>
        </button>
      )}
    </div>
  );
}
