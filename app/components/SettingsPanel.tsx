"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { motion, useReducedMotion } from "framer-motion";

export default function SettingsPanel({
  brandName,
  authorName,
  hasLogo,
  hasAvatar,
  companyMode,
  postCount,
}: {
  brandName: string;
  authorName: string;
  hasLogo: boolean;
  hasAvatar: boolean;
  companyMode: boolean;
  postCount: number;
}) {
  const router = useRouter();
  const [company, setCompany] = useState(companyMode);
  const [savingMode, setSavingMode] = useState(false);

  const toggleMode = async () => {
    const next = !company;
    setCompany(next);
    setSavingMode(true);
    try {
      await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyMode: next }),
      });
      router.refresh();
    } catch {
      setCompany(!next); // revert on failure
    } finally {
      setSavingMode(false);
    }
  };

  return (
    <div className="space-y-4">
      <Section
        title="Posting mode"
        desc="Personal-only writes one first-person post per option for your profile. Company mode also produces a company-page post (A) + a repost caption (B)."
      >
        <div className="flex items-center gap-3">
          <Toggle on={company} disabled={savingMode} onClick={toggleMode} />
          <span className="text-sm text-fg">
            {company ? "Company mode (A / B)" : "Personal-only"}
            <span className="ml-2 text-xs text-muted">{company ? "" : "· default"}</span>
          </span>
        </div>
      </Section>

      <Section
        title="Your voice"
        desc={`${postCount} post${postCount === 1 ? "" : "s"} in your corpus — drafts are written to match this voice. Add more anytime.`}
      >
        <VoiceUploads onChange={() => router.refresh()} />
      </Section>

      <Section
        title="Brand & identity"
        desc="Your company logo appears on company-mode previews; your photo appears on personal-only previews."
      >
        <div className="flex flex-wrap gap-8">
          <ImageUpload which="logo" label={`Company logo${brandName ? ` · ${brandName}` : ""}`} has={hasLogo} rounded="rounded-lg" onChange={() => router.refresh()} />
          <ImageUpload which="avatar" label={`Your photo${authorName ? ` · ${authorName}` : ""}`} has={hasAvatar} rounded="rounded-full" onChange={() => router.refresh()} />
        </div>
      </Section>
    </div>
  );
}

function Section({ title, desc, children }: { title: string; desc: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-border bg-surface p-5">
      <h2 className="text-sm font-semibold text-fg">{title}</h2>
      <p className="mt-0.5 text-xs text-muted">{desc}</p>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Toggle({ on, disabled, onClick }: { on: boolean; disabled?: boolean; onClick: () => void }) {
  const reduce = useReducedMotion();
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      disabled={disabled}
      onClick={onClick}
      className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-60 ${
        on ? "bg-accent" : "bg-border"
      }`}
    >
      <motion.span
        layout={!reduce}
        transition={{ type: "spring", stiffness: 500, damping: 32 }}
        className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow ${on ? "left-[22px]" : "left-0.5"}`}
      />
    </button>
  );
}

type Preview = { column: string; found: number; totalRows: number; usable: number; sample: string[] };

function VoiceUploads({ onChange }: { onChange: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [manual, setManual] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // A dropped file is previewed first (nothing written); the write happens on "Yes, import these".
  const [pending, setPending] = useState<{ file: File; preview: Preview } | null>(null);

  const skippedNote = (n: number | undefined) => (n ? ` ${n} skipped (too short, HTML, or a mail-merge template).` : "");

  const upload = async (file: File) => {
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("preview", "1");
      const r = await fetch("/api/import", { method: "POST", body: fd });
      const j = await r.json();
      if (!r.ok) setErr(j.error || "Import failed.");
      else setPending({ file, preview: j });
    } finally {
      setBusy(false);
    }
  };

  const confirmImport = async () => {
    if (!pending) return;
    setBusy(true);
    setErr(null);
    try {
      const fd = new FormData();
      fd.append("file", pending.file);
      const r = await fetch("/api/import", { method: "POST", body: fd });
      const j = await r.json();
      if (!r.ok) setErr(j.error || "Import failed.");
      else {
        setMsg(`Added ${j.added} post${j.added === 1 ? "" : "s"} (${j.total} total).${skippedNote(j.skipped)}`);
        setPending(null);
        onChange();
      }
    } finally {
      setBusy(false);
    }
  };

  const saveManual = async () => {
    if (!manual.trim()) return;
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const r = await fetch("/api/recent-posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: manual }),
      });
      const j = await r.json();
      if (!r.ok) setErr(j.error || "Save failed.");
      else {
        setMsg(`Added ${j.added} post${j.added === 1 ? "" : "s"}.${skippedNote(j.skipped)}`);
        setManual("");
        onChange();
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <div
        onClick={() => fileRef.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const f = e.dataTransfer.files?.[0];
          if (f) upload(f);
        }}
        className="cursor-pointer rounded-xl border-2 border-dashed border-border bg-elevated/40 p-5 text-center transition hover:border-accent"
      >
        <p className="text-sm text-fg">
          Drop your LinkedIn <strong>.zip</strong> or <strong>Shares.csv</strong>
        </p>
        <p className="mt-0.5 text-xs text-muted">or click to choose a file</p>
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
      {pending && (
        <div className="space-y-2 rounded-xl border border-border bg-elevated/40 p-3">
          <p className="text-xs text-fg">
            Found <strong>{pending.preview.usable}</strong> usable post{pending.preview.usable === 1 ? "" : "s"} in the{" "}
            <code className="font-mono text-accent">{pending.preview.column}</code> column ({pending.preview.found} row
            {pending.preview.found === 1 ? "" : "s"} with text out of {pending.preview.totalRows}). Nothing is saved yet.
          </p>
          {pending.preview.usable === 0 ? (
            <p className="text-xs text-red-400">None of these look like posts (too short, HTML, or a mail-merge template). Wrong file?</p>
          ) : (
            <>
              {pending.preview.sample.map((s, i) => (
                <p key={i} className="whitespace-pre-wrap rounded-lg border border-border bg-elevated p-2.5 text-xs text-fg/90">
                  {s}
                </p>
              ))}
              <p className="text-[11px] text-muted">The two most recent posts found. Import only if they are yours.</p>
            </>
          )}
          <div className="flex items-center gap-2 pt-1">
            <button
              type="button"
              onClick={confirmImport}
              disabled={busy || pending.preview.usable === 0}
              className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white transition hover:opacity-90 disabled:opacity-40"
            >
              {busy ? "importing…" : "Yes, import these"}
            </button>
            <button
              type="button"
              onClick={() => setPending(null)}
              disabled={busy}
              className="rounded-lg border border-border bg-elevated px-3 py-1.5 text-xs text-fg transition hover:border-accent hover:text-accent disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      <details className="text-sm">
        <summary className="cursor-pointer text-xs text-muted hover:text-accent">…or paste a few posts manually</summary>
        <textarea
          value={manual}
          onChange={(e) => setManual(e.target.value)}
          rows={6}
          placeholder={"First post text…\n\n---\n\nSecond post text…"}
          className="mt-2 w-full resize-none rounded-lg border border-border bg-elevated p-3 text-sm text-fg outline-none transition placeholder:text-muted focus:border-accent"
        />
        <button
          onClick={saveManual}
          disabled={busy || !manual.trim()}
          className="mt-2 rounded-lg border border-border bg-elevated px-3 py-1.5 text-xs text-fg transition hover:border-accent hover:text-accent disabled:opacity-50"
        >
          {busy ? "saving…" : "Save posts"}
        </button>
      </details>
      {busy && <p className="text-xs text-muted">Reading…</p>}
      {msg && <p className="text-xs text-good">{msg}</p>}
      {err && <p className="text-xs text-red-400">{err}</p>}
    </div>
  );
}

function ImageUpload({
  which,
  label,
  has,
  rounded,
  onChange,
}: {
  which: "logo" | "avatar";
  label: string;
  has: boolean;
  rounded: string;
  onChange: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [bust, setBust] = useState(0);
  const [present, setPresent] = useState(has);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const upload = async (file: File) => {
    setBusy(true);
    setErr(null);
    try {
      const fd = new FormData();
      fd.append("which", which);
      fd.append("file", file);
      const r = await fetch("/api/upload", { method: "POST", body: fd });
      const j = await r.json();
      if (!r.ok) setErr(j.error || "Upload failed.");
      else {
        setPresent(true);
        setBust((b) => b + 1);
        onChange();
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="text-center">
      <button
        type="button"
        onClick={() => ref.current?.click()}
        className={`flex h-20 w-20 items-center justify-center overflow-hidden border border-border bg-elevated transition hover:border-accent ${rounded}`}
        title={`Upload ${label}`}
      >
        {present ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={`/api/asset?which=${which}&v=${bust}`} alt="" className="h-full w-full object-contain" />
        ) : (
          <span className="text-2xl text-muted">+</span>
        )}
      </button>
      <input
        ref={ref}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) upload(f);
        }}
      />
      <div className="mt-1.5 max-w-[8rem] text-xs text-muted">{label}</div>
      {busy && <div className="text-[11px] text-muted">uploading…</div>}
      {err && <div className="text-[11px] text-red-400">{err}</div>}
    </div>
  );
}
