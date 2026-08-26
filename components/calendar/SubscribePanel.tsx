"use client";

import { useState } from "react";

import { accentDot } from "@/lib/accents";
import type { Accent } from "@/types";

type Feed = { slug: string; name: string; accent: Accent; url: string };

/**
 * Feed URLs with a copy button. Client component purely for the clipboard —
 * the URLs themselves are rendered server-side and work without JavaScript.
 */
export function SubscribePanel({ feeds }: { feeds: Feed[] }) {
  const [copied, setCopied] = useState<string | null>(null);

  async function copy(url: string, slug: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(slug);
      setTimeout(() => setCopied((s) => (s === slug ? null : s)), 1600);
    } catch {
      // Clipboard blocked (insecure context, denied permission) — the URL is
      // visible and selectable regardless, so there is nothing to recover.
    }
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface">
      <div className="flex items-center gap-2 border-b border-border bg-bg/40 px-4 py-2.5">
        <span className="h-3 w-3 rounded-full bg-red-500/80" aria-hidden />
        <span className="h-3 w-3 rounded-full bg-accent-2/80" aria-hidden />
        <span className="h-3 w-3 rounded-full bg-accent-1/80" aria-hidden />
        <span className="ml-2 font-mono text-xs text-muted">subscribe</span>
      </div>

      <div className="p-4">
        <p className="mb-3 text-xs leading-relaxed text-muted">
          Add any of these URLs to Google Calendar, Apple Calendar or Outlook as a
          subscribed calendar. Changes here appear there on the client&apos;s next poll.
        </p>

        <ul className="space-y-2">
          {feeds.map((feed) => (
            <li
              key={feed.slug}
              className="flex items-center gap-2 rounded-lg border border-border bg-bg px-3 py-2"
            >
              <span
                className={`h-2 w-2 shrink-0 rounded-full ${accentDot[feed.accent]}`}
                aria-hidden
              />
              <span className="w-20 shrink-0 truncate text-xs font-medium text-fg">
                {feed.name}
              </span>
              <code className="min-w-0 flex-1 truncate font-mono text-[10px] text-muted">
                {feed.url}
              </code>
              <button
                type="button"
                onClick={() => copy(feed.url, feed.slug)}
                className="shrink-0 rounded border border-border px-2 py-0.5 font-mono text-[10px] text-muted transition-colors duration-200 hover:border-accent-1/50 hover:text-accent-1"
              >
                {copied === feed.slug ? "copied" : "copy"}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
