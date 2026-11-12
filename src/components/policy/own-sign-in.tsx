import { EmptyState, PageHead } from "@/components/ui/kit";
import { Icon } from "@/components/ui/icon";
import { NEEDS_OWN_SIGN_IN } from "@/lib/policies";
import { signInWithOwnNumber } from "@/app/(app)/sale-actions";

/**
 * What Log a sale, Policies and a policy show the shared team password (contract decision 2):
 * client details open only with a person's own sign-in. The button signs this browser out of the
 * shared password and opens the personal sign-in form.
 */
export function OwnSignIn({ title }: { title: string }) {
  return (
    <div className="page page-narrow" data-own-sign-in>
      <PageHead title={title} />
      <section className="card">
        <EmptyState
          icon="lock"
          title={NEEDS_OWN_SIGN_IN}
          body="Sales and policies carry client details, so they open only with your own cell number and password. No sign-in yet? Ask an admin for the join link."
          action={
            <form action={signInWithOwnNumber} method="post">
              <button type="submit" className="btn btn-primary">
                <Icon name="user" size={18} />
                <span>Sign in with your own number</span>
              </button>
            </form>
          }
        />
      </section>
    </div>
  );
}
