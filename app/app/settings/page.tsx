import Link from "next/link";
import { getStatus } from "@/lib/drafts";
import SettingsPanel from "@/components/SettingsPanel";

export const dynamic = "force-dynamic";

export default function SettingsPage() {
  const s = getStatus();
  return (
    <div>
      <Link href="/" className="text-sm text-muted hover:text-accent">
        ← back
      </Link>
      <h1 className="my-4 text-lg font-semibold text-fg">Settings</h1>
      <SettingsPanel
        brandName={s.brandName}
        authorName={s.authorName}
        hasLogo={s.hasLogo}
        hasAvatar={s.hasAvatar}
        companyMode={s.companyMode}
        postCount={s.recentPostCount}
      />
    </div>
  );
}
