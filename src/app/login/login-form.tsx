"use client";

import { useActionState } from "react";
import { login, type LoginState } from "./actions";
import { Button, Input, Label, Notice } from "@/components/ui";

export function LoginForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState<LoginState, FormData>(login, { error: null });
  return (
    <form action={action} className="space-y-4">
      {state.error && <Notice tone="red">{state.error}</Notice>}
      <input type="hidden" name="next" value={next} />
      <div>
        <Label htmlFor="password" className="font-semibold">
          Password
        </Label>
        <Input id="password" name="password" type="password" autoComplete="current-password" className="h-12 rounded-2xl text-[17px]" autoFocus required />
      </div>
      <Button type="submit" className="h-12 w-full rounded-2xl text-[15px]" disabled={pending}>
        {pending ? "Checking..." : "Sign in"}
      </Button>
    </form>
  );
}
