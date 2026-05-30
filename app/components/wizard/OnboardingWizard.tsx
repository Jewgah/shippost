"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";

type ImportResp = { added: number; found: number; totalRows: number; column: string; total: number; error?: string };

export default function OnboardingWizard({ authorName }: { authorName: string }) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportResp | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [manual, setManual] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const finish = async () => {
    setBusy(true);
    try {
      await fetch("/api/onboarded", { method: "POST" });
      router.push("/");
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  const upload = async (file: File) => {
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/import", { method: "POST", body: fd });
      const json: ImportResp = await res.json();
      if (!res.ok) setError(json.error || "Import failed.");
      else {
        setResult(json);
        setStep(4);
      }
    } catch (e) {
      setError(String((e as Error).message));
    } finally {
      setBusy(false);
    }
  };

  const submitManual = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/recent-posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: manual }),
      });
      const json = await res.json();
      if (!res.ok) setError(json.error || "Save failed.");
      else {
        setResult({ added: json.added, found: json.added, totalRows: json.added, column: "manual", total: json.total });
        setStep(4);
      }
    } finally {
      setBusy(false);
    }
  };

  const steps = [
    // 0 — welcome
    <Panel key="0" title={`Welcome${authorName ? `, ${authorName.split(" ")[0]}` : ""} 👋`}>
      <p>
        shippost writes your LinkedIn posts in <strong>your</strong> voice. To learn that voice, it reads a
        few posts you’ve already published.
      </p>
      <p className="text-muted">
        Everything stays on your machine — nothing is uploaded anywhere. LinkedIn blocks reading your
        profile automatically, so we’ll grab your posts from their official data export instead.
      </p>
      <Nav onNext={() => setStep(1)} onSkip={finish} busy={busy} />
    </Panel>,

    // 1 — export guide
    <Panel key="1" title="Step 1 — request your LinkedIn data">
      <ol className="list-decimal space-y-2 pl-5">
        <li>On LinkedIn: click your photo → <strong>Settings &amp; Privacy</strong>.</li>
        <li>Go to <strong>Data Privacy</strong> → <strong>Get a copy of your data</strong>.</li>
        <li>Pick <strong>“Posts”</strong> (or the specific “Shares” option), then <strong>Request archive</strong>.</li>
        <li>The posts file is usually ready in a few minutes (the full archive can take up to 24h). You’ll get an email with a download link.</li>
        <li>Download the ZIP. Inside is a <code className="font-mono text-accent">Shares.csv</code> with your post text.</li>
      </ol>
      <Nav onBack={() => setStep(0)} onNext={() => setStep(2)} nextLabel="I have my file" onSkip={finish} busy={busy} />
    </Panel>,

    // 2 — drop file
    <Panel key="2" title="Step 2 — drop your export">
      <div
        onClick={() => fileRef.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const f = e.dataTransfer.files?.[0];
          if (f) upload(f);
        }}
        className="cursor-pointer rounded-xl border-2 border-dashed border-border bg-bg/40 p-8 text-center transition hover:border-accent"
      >
        <p className="text-fg">Drop your <strong>.zip</strong> or <strong>Shares.csv</strong> here</p>
        <p className="mt-1 text-xs text-muted">or click to choose a file</p>
        <input
          ref={fileRef}
          type="file"
          accept=".zip,.csv"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) upload(f);
          }}
        />
      </div>
      {busy && <p className="text-sm text-muted">Reading your posts…</p>}
      {error && <p className="text-sm text-red-400">{error}</p>}
      <button onClick={() => setStep(3)} className="text-sm text-muted underline hover:text-accent">
        I’d rather paste a few posts manually
      </button>
      <Nav onBack={() => setStep(1)} onSkip={finish} busy={busy} />
    </Panel>,

    // 3 — manual paste
    <Panel key="3" title="Paste a few posts">
      <p className="text-muted">Paste 3–5 posts you’ve written. Separate them with a line containing just <code className="font-mono">---</code>.</p>
      <textarea
        value={manual}
        onChange={(e) => setManual(e.target.value)}
        rows={8}
        placeholder={"First post text…\n\n---\n\nSecond post text…"}
        className="w-full rounded-lg border border-border bg-bg/40 p-3 text-sm text-fg outline-none focus:border-accent"
      />
      {error && <p className="text-sm text-red-400">{error}</p>}
      <Nav
        onBack={() => setStep(2)}
        onNext={submitManual}
        nextLabel="Save my voice"
        nextDisabled={!manual.trim()}
        onSkip={finish}
        busy={busy}
      />
    </Panel>,

    // 4 — done
    <Panel key="4" title="You’re set ✅">
      {result && (
        <p>
          Added <strong>{result.added}</strong> post{result.added === 1 ? "" : "s"} to your voice corpus
          {result.column !== "manual" && <> (from the <code className="font-mono">{result.column}</code> column)</>}.
        </p>
      )}
      <p className="text-muted">
        shippost will match this voice and avoid repeating these themes. You can re-import anytime, and every
        post you mark “I posted this” gets added automatically.
      </p>
      <Nav onNext={finish} nextLabel="See my drafts" busy={busy} />
    </Panel>,
  ];

  return (
    <div className="mx-auto max-w-xl">
      <Dots step={step} total={5} />
      <AnimatePresence mode="wait">
        <motion.div
          key={step}
          initial={{ opacity: 0, x: 24 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -24 }}
          transition={{ duration: 0.25 }}
        >
          {steps[step]}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-6">
      <h1 className="mb-3 text-xl font-semibold text-fg">{title}</h1>
      <div className="space-y-3 text-sm leading-relaxed text-fg/90">{children}</div>
    </div>
  );
}

function Nav({
  onBack,
  onNext,
  onSkip,
  nextLabel = "Next",
  nextDisabled,
  busy,
}: {
  onBack?: () => void;
  onNext?: () => void;
  onSkip?: () => void;
  nextLabel?: string;
  nextDisabled?: boolean;
  busy?: boolean;
}) {
  return (
    <div className="flex items-center gap-3 pt-3">
      {onBack && (
        <button onClick={onBack} className="text-sm text-muted hover:text-fg">
          ← back
        </button>
      )}
      <div className="ml-auto flex items-center gap-3">
        {onSkip && (
          <button onClick={onSkip} className="text-sm text-muted hover:text-fg">
            skip for now
          </button>
        )}
        {onNext && (
          <button
            onClick={onNext}
            disabled={nextDisabled || busy}
            className="rounded-lg bg-accent px-4 py-1.5 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-40"
          >
            {busy ? "…" : nextLabel}
          </button>
        )}
      </div>
    </div>
  );
}

function Dots({ step, total }: { step: number; total: number }) {
  return (
    <div className="mb-4 flex justify-center gap-1.5">
      {Array.from({ length: total }).map((_, i) => (
        <span
          key={i}
          className={`h-1.5 rounded-full transition-all ${i === step ? "w-6 bg-accent" : "w-1.5 bg-border"}`}
        />
      ))}
    </div>
  );
}
