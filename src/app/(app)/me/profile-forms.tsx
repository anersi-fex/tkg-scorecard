"use client";

import { useRef, useState, useTransition, type FormEvent } from "react";
import { Switch } from "@/components/switch";
import { Field, Panel, TextInput, btn } from "@/components/ui/kit";
import { toast } from "@/components/toaster";
import { PasswordField } from "@/app/login/password-field";
import { changeMyPassword, signOutEverywhere, updateMyProfile } from "@/app/(app)/people-actions";

interface Props {
  name: string;
  /** The person's own number as they read it ("(248) 555-0100"), "" when they have none yet. */
  phone: string;
  inOffice: boolean;
  upline: string | null;
  /** They have a password already (Change password asks for it first). */
  hasLogin: boolean;
  /** Signed in with their own number (not a shared password): Sign out everywhere applies. */
  ownSession: boolean;
}

/** Forms submit through onSubmit, so a refused save keeps what was typed. */
export function ProfileForms({ name, phone, inOffice, upline, hasLogin, ownSession }: Props) {
  return (
    <div className="grid-2 items-start">
      <AboutForm name={name} phone={phone} inOffice={inOffice} upline={upline} />
      <div className="stack">
        <PasswordForm hasLogin={hasLogin} />
        {ownSession && <SignOutCard />}
      </div>
    </div>
  );
}

function AboutForm({ name, phone, inOffice, upline }: Pick<Props, "name" | "phone" | "inOffice" | "upline">) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [office, setOffice] = useState(inOffice);
  const [officeBusy, startOffice] = useTransition();

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    const form = new FormData(e.currentTarget);
    setError(null);
    start(async () => {
      const r = await updateMyProfile(form);
      if (r.ok) toast(r.message ?? "Saved.");
      else setError(r.error);
    });
  }

  function toggleOffice(next: boolean) {
    setOffice(next);
    startOffice(async () => {
      const form = new FormData();
      form.set("in_office", next ? "1" : "0");
      const r = await updateMyProfile(form);
      if (r.ok) toast(next ? "In the office: you're in the top group." : "Not in the office.");
      else {
        setOffice(!next);
        toast(r.error, false);
      }
    });
  }

  return (
    <Panel title="About you" sub="Your name and number, as the board and your sign-in know them.">
      <form method="post" onSubmit={onSubmit} className="stack" data-me="about">
        <Field label="First and last name" htmlFor="me-name" required>
          <TextInput id="me-name" name="name" defaultValue={name} autoComplete="name" autoCapitalize="words" maxLength={60} required />
        </Field>
        <Field label="Cell number" htmlFor="me-phone" help="This is the number you sign in with.">
          <TextInput id="me-phone" name="phone" type="tel" inputMode="tel" autoComplete="tel" defaultValue={phone} placeholder="248 555 0100" />
        </Field>
        {error && <p className="form-alert">{error}</p>}
        <div className="flex justify-end">
          <button type="submit" className={btn("primary")} disabled={pending}>
            {pending ? "Saving..." : "Save"}
          </button>
        </div>
      </form>
      <div className="mt-4 flex min-h-12 items-center justify-between gap-3 border-t border-line pt-4">
        <div className="min-w-0">
          <p className="strong">I work in the office</p>
          <p className="small muted">The office group is at the top of the board.</p>
        </div>
        <Switch checked={office} onChange={toggleOffice} disabled={officeBusy} label="I work in the office" />
      </div>
      <div className="mt-4 border-t border-line pt-4" data-me="upline">
        <p className="small muted">Your upline</p>
        <p className="mt-1 strong">{upline ?? "Nobody yet"}</p>
        <p className="small muted">Ask an admin to change it.</p>
      </div>
    </Panel>
  );
}

function PasswordForm({ hasLogin }: { hasLogin: boolean }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    const form = new FormData(e.currentTarget);
    setError(null);
    start(async () => {
      const r = await changeMyPassword(form);
      if (r.ok) {
        toast(r.message ?? "Password changed.");
        formRef.current?.reset();
      } else setError(r.error);
    });
  }

  return (
    <Panel title={hasLogin ? "Change password" : "Set a password"} sub="8 characters or more. Your other phones and computers are signed out.">
      <form ref={formRef} method="post" onSubmit={onSubmit} className="stack" data-me="password">
        {hasLogin && (
          <Field label="Current password" htmlFor="me-current" required>
            <PasswordField id="me-current" name="current" autoComplete="current-password" required />
          </Field>
        )}
        <Field label="New password" htmlFor="me-password" required>
          <PasswordField id="me-password" name="password" autoComplete="new-password" minLength={8} maxLength={200} required />
        </Field>
        {error && <p className="form-alert">{error}</p>}
        <div className="flex justify-end">
          <button type="submit" className={btn("secondary")} disabled={pending}>
            {pending ? "Saving..." : hasLogin ? "Change password" : "Set password"}
          </button>
        </div>
      </form>
    </Panel>
  );
}

function SignOutCard() {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <Panel title="Sign out everywhere" sub="Signs you out on every phone and computer, this one too. Use it if you lost a phone.">
      {error && <p className="form-alert mb-3">{error}</p>}
      <button
        type="button"
        data-me="signout"
        className={btn("danger")}
        disabled={pending}
        onClick={() => {
          if (!window.confirm("Sign out on every phone and computer, this one too?")) return;
          setError(null);
          start(async () => {
            // When it works the action sends this device to the sign-in screen and never comes back here.
            const r = await signOutEverywhere();
            if (r && !r.ok) setError(r.error);
          });
        }}
      >
        {pending ? "Signing out..." : "Sign out everywhere"}
      </button>
    </Panel>
  );
}
