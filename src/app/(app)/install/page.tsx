import type { Metadata } from "next";
import { pageViewer } from "@/lib/auth";
import { appBase } from "@/lib/app-url";
import { InstallGuide } from "./install-guide";

export const metadata: Metadata = { title: "Put it on your phone" };

/**
 * "Put Scorecard on your phone" (owner, 2026-11-12: "a nice interactive one where they just click
 * ... tells them how many clicks to make and what to do ... automatically detect it"). The guide
 * itself runs on the phone (install-guide.tsx): only the phone knows what it is. With ?welcome=1
 * it is the last step after joining.
 */
export default async function InstallPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const viewer = await pageViewer();
  const params = await searchParams;
  const welcome = params.welcome === "1";
  const base = await appBase();
  // The welcome line greets a person by their first name; the shared passwords name nobody.
  const first = viewer.name?.trim().split(/\s+/)[0] || null;
  return <InstallGuide welcome={welcome} firstName={first} address={base ? `${base}/install` : ""} />;
}
