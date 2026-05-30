import { redirect } from "next/navigation";
import { getStatus, listDrafts } from "@/lib/drafts";
import DraftList from "@/components/DraftList";

export const dynamic = "force-dynamic";

export default function Home() {
  const status = getStatus();
  if (status.firstLaunch) redirect("/onboarding");

  const drafts = listDrafts();
  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-fg">Your drafts</h1>
        <p className="mt-1 text-sm text-muted">
          Each run gives you 5 ranked options. Open one, pick the post you like, publish it, then hit
          “I posted this”.
        </p>
      </div>
      <DraftList drafts={drafts} />
    </div>
  );
}
