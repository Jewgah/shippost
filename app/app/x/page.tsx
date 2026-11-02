import { redirect } from "next/navigation";
import { getStatus, listDrafts } from "@/lib/drafts";
import { pickData } from "@/lib/voice";
import DraftList from "@/components/DraftList";
import GeneratePanel from "@/components/GeneratePanel";
import CadenceBar from "@/components/CadenceBar";

export const dynamic = "force-dynamic";

export default function XHome() {
  const status = getStatus();
  if (status.firstLaunch) redirect("/onboarding");

  const { pickedByDraftId, cadence } = pickData("x");
  const drafts = listDrafts(pickedByDraftId, "x");
  return (
    <div>
      <GeneratePanel channel="x" />
      {drafts.length > 0 && <CadenceBar cadence={cadence} />}
      <DraftList drafts={drafts} channel="x" />
    </div>
  );
}
