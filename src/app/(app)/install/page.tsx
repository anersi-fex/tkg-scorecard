import type { Metadata } from "next";
import * as auth from "@/lib/auth";
import { appBase } from "@/lib/app-url";
import type { Viewer } from "@/lib/viewer";
import { InstallGuide } from "./install-guide";

export const metadata: Metadata = { title: "Put it on your phone" };

/** The signed-in person's first name for the welcome line, once sign-ins name a person (`currentViewer` in auth.ts). */
async function firstName(): Promise<string | null> {
  const read = (auth as unknown as { currentViewer?: () => Promise<Viewer | null> }).currentViewer;
  if (typeof read !== "function") return null;
  try {
    const name = (await read())?.name?.trim();
    return name ? name.split(/\s+/)[0] : null;
  } catch {
    return null;
  }
}

/**
 * "Put Scorecard on your phone" (owner, 2026-11-12: "a nice interactive one where they just click
 * ... tells them how many clicks to make and what to do ... automatically detect it"). The guide
 * itself runs on the phone (install-guide.tsx): only the phone knows what it is. With ?welcome=1
 * it is the last step after joining.
 */
export default async function InstallPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await auth.requirePage();
  const params = await searchParams;
  const welcome = params.welcome === "1";
  const [name, base] = await Promise.all([welcome ? firstName() : Promise.resolve(null), appBase()]);
  return <InstallGuide welcome={welcome} firstName={name} address={base ? `${base}/install` : ""} />;
}
