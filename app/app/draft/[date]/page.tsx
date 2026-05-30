import Link from "next/link";
import { notFound } from "next/navigation";
import { readDraft, getStatus } from "@/lib/drafts";
import OptionCard from "@/components/OptionCard";

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
        <h1 className="font-mono text-lg text-fg">{draft.title || `Drafts — ${date}`}</h1>
        {draft.instruction && (
          <p className="mt-2 rounded-lg border border-border bg-surface/60 px-3 py-2 text-xs text-muted">
            {draft.instruction}
          </p>
        )}
      </div>

      <div className="space-y-4">
        {draft.options.map((o, i) => (
          <OptionCard
            key={o.n || i}
            option={o}
            date={date}
            brandName={status.brandName}
            hasLogo={status.hasLogo}
            index={i}
          />
        ))}
      </div>

      {draft.footer && (
        <details className="mt-6 text-xs text-muted">
          <summary className="cursor-pointer">run metadata</summary>
          <pre className="mt-2 whitespace-pre-wrap">{draft.footer}</pre>
        </details>
      )}
    </div>
  );
}
