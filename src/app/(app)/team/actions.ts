"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireViewer } from "@/lib/auth";
import { addAgent, listAgents, updateAgent } from "@/lib/data";
import { cleanName, setInOffice, setUpline } from "@/lib/people";
import type { ActionResult } from "../actions";

/**
 * People > Add a person (owner, 2026-11-12): a name, whose team they are on and whether they
 * work in the office, in one step. The owner or an admin, checked here on the server. Someone
 * who was taken off the board comes back instead of being added twice.
 */
export async function addPersonToTeam(form: FormData): Promise<ActionResult> {
  try {
    await requireViewer("manager");
    const name = cleanName(form.get("name"));
    if (!name) return { ok: false, error: "Type the person's first and last name." };
    const rawUpline = String(form.get("upline_id") ?? "").trim();
    const uplineId = rawUpline ? rawUpline : null;
    if (uplineId !== null && !z.string().uuid().safeParse(uplineId).success) return { ok: false, error: "Pick the upline again." };
    const inOffice = String(form.get("in_office") ?? "") === "1";
    const existing = await listAgents({ includeInactive: true });
    if (uplineId && !existing.some((a) => a.id === uplineId && a.active)) return { ok: false, error: "That upline isn't on the board." };
    const dup = existing.find((a) => a.name.toLowerCase() === name.toLowerCase());
    if (dup?.active) return { ok: false, error: `${dup.name} is already on the board.` };
    let id: string;
    if (dup) {
      await updateAgent(dup.id, { active: true });
      id = dup.id;
    } else {
      id = (await addAgent(name)).id;
    }
    // The person is on the board from here on; a team or office mark that does not save is said plainly.
    let note = "";
    try {
      if (uplineId && uplineId !== id) await setUpline(id, uplineId);
      await setInOffice(id, inOffice);
    } catch (err) {
      note = ` ${err instanceof Error ? err.message : "Their team did not save."} Open them to set it.`;
    }
    revalidatePath("/", "layout");
    return { ok: true, id, message: `${dup ? `${dup.name} is back on the board.` : `${name} is on the board.`}${note}` };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Something went wrong." };
  }
}
