import Link from "next/link";
import { getStatus } from "@/lib/drafts";
import QueueBoard from "@/components/QueueBoard";

export const dynamic = "force-dynamic";

export default function QueuePage() {
  const s = getStatus();
  return (
    <div>
      <Link href="/" className="text-sm text-muted hover:text-accent">
        ← back
      </Link>
      <h1 className="my-4 text-lg font-semibold text-fg">LinkedIn queue</h1>
      <QueueBoard brandName={s.brandName} hasLogo={s.hasLogo} authorName={s.authorName} hasAvatar={s.hasAvatar} />
    </div>
  );
}
