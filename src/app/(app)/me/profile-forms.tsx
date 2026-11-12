"use client";

import { useRef, useState, useTransition, type FormEvent } from "react";
import { Button, Card, Input, Label } from "@/components/ui";
import { Switch } from "@/components/switch";
import { Eyebrow } from "@/components/tide";
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

const FIELD = "h-12 rounded-2xl text-[17px]";

/** Forms submit through onSubmit, so a refused save keeps what was typed. */
export function ProfileForms({ name, phone, inOffice, upline, hasLogin, ownSession }: Props) {
  return (
    <>
      <AboutForm name={name} phone={phone} inOffice={inOffice} upline={upline} />
      <PasswordForm hasLogin={hasLogin} />
      {ownSession && <SignOutCard />}
    </>
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
    <Card className="space-y-4">
      <form method="post" onSubmit={onSubmit} className="space-y-4" data-me="about">
        <div>
          <Label htmlFor="me-name" className="font-semibold">
            First and last name
          </Label>
          <Input id="me-name" name="name" defaultValue={name} autoComplete="name" autoCapitalize="words" maxLength={60} className={FIELD} required />
        </div>
        <div>
          <Label htmlFor="me-phone" className="font-semibold">
            Cell number
          </Label>
          <Input id="me-phone" name="phone" type="tel" inputMode="tel" autoComplete="tel" defaultValue={phone} placeholder="248 555 0100" className={FIELD} />
          <p className="mt-1.5 text-[12.5px] text-gray-500">This is the number you sign in with.</p>
        </div>
        {error && <p className="text-[13px] leading-snug text-red-700">{error}</p>}
        <Button type="submit" className="h-12 w-full rounded-2xl text-[15px]" disabled={pending}>
          {pending ? "Saving..." : "Save"}
        </Button>
      </form>
      <div className="flex min-h-12 items-center justify-between gap-3 border-t border-line pt-4">
        <div className="min-w-0">
          <p className="text-[16px] font-semibold text-gray-900">I work in the office</p>
          <p className="text-[13px] leading-snug text-gray-500">The office group is at the top of the board.</p>
        </div>
        <Switch checked={office} onChange={toggleOffice} disabled={officeBusy} label="I work in the office" />
      </div>
      <div className="border-t border-line pt-4" data-me="upline">
        <Eyebrow>Your upline</Eyebrow>
        <p className="mt-1.5 text-[16px] font-semibold text-gray-900">{upline ?? "Nobody yet"}</p>
        <p className="text-[13px] text-gray-500">Ask an admin to change it.</p>
      </div>
    </Card>
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
    <Card>
      <form ref={formRef} method="post" onSubmit={onSubmit} className="space-y-4" data-me="password">
        <h2 className="text-[18px] leading-tight font-extrabold tracking-[-0.02em] text-gray-900">{hasLogin ? "Change password" : "Set a password"}</h2>
        {hasLogin && (
          <div>
            <Label htmlFor="me-current" className="font-semibold">
              Current password
            </Label>
            <PasswordField id="me-current" name="current" autoComplete="current-password" required />
          </div>
        )}
        <div>
          <Label htmlFor="me-password" className="font-semibold">
            New password
          </Label>
          <PasswordField id="me-password" name="password" autoComplete="new-password" minLength={8} maxLength={200} required />
          <p className="mt-1.5 text-[12.5px] text-gray-500">8 characters or more. Your other phones and computers are signed out.</p>
        </div>
        {error && <p className="text-[13px] leading-snug text-red-700">{error}</p>}
        <Button type="submit" variant="secondary" className="h-12 w-full rounded-2xl text-[15px]" disabled={pending}>
          {pending ? "Saving..." : hasLogin ? "Change password" : "Set password"}
        </Button>
      </form>
    </Card>
  );
}

function SignOutCard() {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <Card>
      <h2 className="text-[18px] leading-tight font-extrabold tracking-[-0.02em] text-gray-900">Sign out everywhere</h2>
      <p className="mt-1 text-[13.5px] leading-snug text-gray-600">Signs you out on every phone and computer, this one too. Use it if you lost a phone.</p>
      {error && <p className="mt-2 text-[13px] leading-snug text-red-700">{error}</p>}
      <Button
        type="button"
        variant="secondary"
        data-me="signout"
        className="mt-3 h-12 w-full rounded-2xl text-[15px] text-red-700"
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
      </Button>
    </Card>
  );
}
