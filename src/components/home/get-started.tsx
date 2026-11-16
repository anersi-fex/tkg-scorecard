import Link from "next/link";
import { Panel } from "@/components/ui/kit";
import { LinkBox } from "@/components/link-box";

/**
 * The one small card on Home for a person with no policy yet and nobody on their team (the
 * rollout, 2026-11-16): three steps in plain words. It goes away on its own once they have a
 * policy or a teammate (the page decides; nothing is saved). The team link is theirs: it lands the
 * people who use it on their team.
 */
export function GetStartedCard({ teamLink, agency }: { teamLink: string | null; agency: string }) {
  return (
    <Panel title="Get started" sub="Three steps. This goes away once you have a sale or a teammate." data-get-started>
      <ol className="m-0 list-none space-y-3 p-0 text-[14px] text-fg">
        <Step n={1}>
          <Link href="/log" className="font-medium text-accent-text hover:underline">
            Log a sale
          </Link>
        </Step>
        <Step n={2}>
          <Link href="/policies" className="font-medium text-accent-text hover:underline">
            See your policies
          </Link>
        </Step>
        <Step n={3}>
          <span className="font-medium">Send your team link</span>
          {teamLink && (
            <div className="mt-2" data-get-started-link>
              <LinkBox url={teamLink} label="My team link" shareText={`Join Scorecard for ${agency} on my team. Tap the link and set up your own sign-in.`} />
            </div>
          )}
        </Step>
      </ol>
    </Panel>
  );
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span aria-hidden className="mt-px grid size-6 shrink-0 place-items-center rounded-full bg-accent-soft text-[12px] font-semibold text-accent-text">
        {n}
      </span>
      <div className="min-w-0 flex-1 pt-0.5">{children}</div>
    </li>
  );
}
