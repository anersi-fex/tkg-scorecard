import Link from "next/link";
import { ScoreLockup } from "@/components/brand";

export default function NotFound() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center px-4 py-10 text-center">
      <ScoreLockup size={44} />
      <h1 className="mt-8 text-[24px] leading-tight font-extrabold tracking-[-0.03em] text-gray-900">That page isn&apos;t here</h1>
      <p className="mt-2 text-[14px] text-gray-600">The link may be old, or the page moved.</p>
      <Link href="/" className="mt-6 inline-flex min-h-11 items-center rounded-xl bg-tide-strong px-5 text-sm font-bold text-white shadow-glow">
        Go home
      </Link>
    </main>
  );
}
