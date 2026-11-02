import Link from "next/link";
import { notFound } from "next/navigation";
import { readDraft } from "@/lib/drafts";
import { rejectedOptionsByDraftId } from "@/lib/voice";
import DraftCarousel from "@/components/DraftCarousel";
import { formatDraftId } from "@/lib/draftId";

export const dynamic = "force-dynamic";

export default async function XDraftPage({ params }: { params: Promise<{ date: string }> }) {
  const { date } = await params;
  const draft = readDraft(date, "x");
  if (!draft) notFound();

  const rejectedOptions = rejectedOptionsByDraftId("x")[date] ?? [];

  return (
    <div>
      <Link href="/x" className="text-sm text-muted hover:text-accent">
        ← all X drafts
      </Link>

      <div className="my-4">
        <h1 className="font-mono text-lg text-fg">{draft.title || `X drafts - ${formatDraftId(date)}`}</h1>
        <div className="mt-1 font-mono text-xs text-muted">{formatDraftId(date)}</div>
        {draft.instruction && (
          <p className="mt-2 rounded-lg border border-border bg-surface/60 px-3 py-2 text-xs text-muted">
            {draft.instruction}
          </p>
        )}
      </div>

      <DraftCarousel
        options={draft.options}
        date={date}
        brandName=""
        hasLogo={false}
        companyMode={false}
        authorName=""
        hasAvatar={false}
        rejectedOptions={rejectedOptions}
        channel="x"
      />
    </div>
  );
}
