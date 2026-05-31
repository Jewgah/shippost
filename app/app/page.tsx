import { redirect } from "next/navigation";
import { getStatus, listDrafts } from "@/lib/drafts";
import DraftList from "@/components/DraftList";
import GeneratePanel from "@/components/GeneratePanel";

export const dynamic = "force-dynamic";

export default function Home() {
  const status = getStatus();
  if (status.firstLaunch) redirect("/onboarding");

  const drafts = listDrafts();
  return (
    <div>
      <GeneratePanel />
      <DraftList drafts={drafts} />
    </div>
  );
}
