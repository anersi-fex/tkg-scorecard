import Link from "next/link";
import { ScoreLockup } from "@/components/brand";
import { loadLook } from "@/lib/look-setting";

export default async function NotFound() {
  const { agencyName } = await loadLook();
  return (
    <main className="flex flex-1 flex-col items-center justify-center px-4 py-10 text-center">
      <ScoreLockup size={44} agency={agencyName} />
      <h1 className="mt-8 text-[24px] leading-tight font-medium tracking-[-0.01em] text-fg">That page isn&apos;t here</h1>
      <p className="mt-2 text-[13.5px] text-fg-2">The link may be old, or the page moved.</p>
      <Link href="/" className="btn btn-primary mt-6">
        Go home
      </Link>
    </main>
  );
}
