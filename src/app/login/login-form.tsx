"use client";

import { useRef, useState, useTransition, type FormEvent } from "react";
import { login, signIn, type LoginState } from "./actions";
import { Button, Input, Label, Notice } from "@/components/ui";
import { PasswordField } from "./password-field";

export type LoginWay = "person" | "team";

/**
 * Two ways in on one screen: a person's own sign-in (cell number and password), or the shared
 * password (the team's, the TV's, the owner's). The quiet link under the button swaps them.
 * Submits through onSubmit, so a wrong try keeps the number that was typed.
 */
export function LoginForm({ next, start }: { next: string; start: LoginWay }) {
  const [way, setWay] = useState<LoginWay>(start);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    const form = new FormData(e.currentTarget);
    setError(null);
    startTransition(async () => {
      const action = way === "person" ? signIn : login;
      let state: LoginState;
      try {
        state = await action({ error: null }, form);
      } catch {
        state = { error: "Scorecard didn't answer. Check your connection and try again." };
      }
      // A right password never comes back here: the action sends the browser on.
      if (state?.error) {
        setError(state.error);
        const field = formRef.current?.querySelector<HTMLInputElement>("#password");
        if (field) {
          field.value = "";
          field.focus();
        }
      }
    });
  }

  function swap(to: LoginWay) {
    setWay(to);
    setError(null);
  }

  return (
    <form ref={formRef} method="post" onSubmit={onSubmit} className="space-y-4" data-way={way}>
      {error && <Notice tone="red">{error}</Notice>}
      <input type="hidden" name="next" value={next} />
      {way === "person" ? (
        <>
          <div>
            <Label htmlFor="phone" className="font-semibold">
              Cell number
            </Label>
            <Input key="phone" id="phone" name="phone" type="tel" inputMode="tel" autoComplete="tel" placeholder="248 555 0100" className="h-12 rounded-2xl text-[17px]" autoFocus required />
          </div>
          <div>
            <Label htmlFor="password" className="font-semibold">
              Password
            </Label>
            <PasswordField key="person-password" id="password" name="password" autoComplete="current-password" required />
          </div>
        </>
      ) : (
        <div>
          <Label htmlFor="password" className="font-semibold">
            Team password
          </Label>
          <Input key="team-password" id="password" name="password" type="password" autoComplete="current-password" className="h-12 rounded-2xl text-[17px]" autoFocus required />
        </div>
      )}
      <Button type="submit" className="h-12 w-full rounded-2xl text-[15px]" disabled={pending}>
        {pending ? "Checking..." : "Sign in"}
      </Button>
      <div className="text-center">
        {way === "person" ? (
          <button type="button" onClick={() => swap("team")} className="min-h-11 rounded-xl px-3 text-[14px] font-semibold text-accent-text hover:bg-tint">
            Use the team password
          </button>
        ) : (
          <button type="button" onClick={() => swap("person")} className="min-h-11 rounded-xl px-3 text-[14px] font-semibold text-accent-text hover:bg-tint">
            Use your own sign-in
          </button>
        )}
      </div>
    </form>
  );
}
