"use client";
import Link from "next/link";
import ThemeSwitcher from "./ThemeSwitcher";

export default function TopBar({ brandName }: { brandName: string }) {
  return (
    <header className="sticky top-0 z-20 border-b border-border bg-bg/80 backdrop-blur">
      <div className="mx-auto flex max-w-3xl items-center justify-between px-5 py-3">
        <Link href="/" className="flex items-baseline gap-2">
          <span className="font-mono text-lg font-bold tracking-tight text-fg">
            ship<span className="text-accent">post</span>
          </span>
          {brandName && (
            <span className="text-xs text-muted">· {brandName}</span>
          )}
        </Link>
        <ThemeSwitcher />
      </div>
    </header>
  );
}
