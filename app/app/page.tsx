import { redirect } from "next/navigation";
import { getStatus, listDrafts } from "@/lib/drafts";
import { pickData } from "@/lib/voice";
import DraftList from "@/components/DraftList";
import GeneratePanel from "@/components/GeneratePanel";
import CadenceBar from "@/components/CadenceBar";

export const dynamic = "force-dynamic";

export default function Home() {
  const status = getStatus();
  if (status.firstLaunch) redirect("/onboarding");

  // One read of the picks log feeds both the posted badges and the cadence bar.
  const { pickedByDraftId, cadence } = pickData();
  const drafts = listDrafts(pickedByDraftId);
  return (
    <div>
      <GeneratePanel />
      {drafts.length > 0 && <CadenceBar cadence={cadence} />}
      <DraftList drafts={drafts} />
    </div>
  );
}
