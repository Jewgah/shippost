import { getStatus } from "@/lib/drafts";
import OnboardingWizard from "@/components/wizard/OnboardingWizard";

export const dynamic = "force-dynamic";

export default function OnboardingPage() {
  const status = getStatus();
  return <OnboardingWizard authorName={status.authorName} />;
}
