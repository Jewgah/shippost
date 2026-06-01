import Link from "next/link";
import { notFound } from "next/navigation";
import { readDraft, getStatus } from "@/lib/drafts";
import DraftCarousel from "@/components/DraftCarousel";
import { formatDraftId } from "@/lib/draftId";

export const dynamic = "force-dynamic";

export default async function DraftPage({ params }: { params: Promise<{ date: string }> }) {
  const { date } = await params;
  const draft = readDraft(date);
  if (!draft) notFound();

  const status = getStatus();

  return (
    <div>
      <Link href="/" className="text-sm text-muted hover:text-accent">
        ← all drafts
      </Link>

      <div className="my-4">
        <h1 className="font-mono text-lg text-fg">{draft.title || `Drafts — ${formatDraftId(date)}`}</h1>
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
        brandName={status.brandName}
        hasLogo={status.hasLogo}
        companyMode={status.companyMode}
        authorName={status.authorName}
        hasAvatar={status.hasAvatar}
      />

      {draft.footer && (
        <details className="mt-6 text-xs text-muted">
          <summary className="cursor-pointer">run metadata</summary>
          <pre className="mt-2 whitespace-pre-wrap">{draft.footer}</pre>
        </details>
      )}
    </div>
  );
}
