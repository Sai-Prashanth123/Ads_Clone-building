"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * The console's spine.
 *
 * Collapses to icons on narrow screens rather than disappearing behind a
 * hamburger — on an instrument panel, knowing where you are matters more than
 * reclaiming 180px.
 */

type Item = {
  href: string;
  label: string;
  hint: string;
  glyph: string;
};

const ITEMS: Item[] = [
  { href: "/", label: "Studio", hint: "Clone one ad", glyph: "◆" },
  { href: "/batches", label: "Batches", hint: "Bulk runs", glyph: "▤" },
  { href: "/library", label: "Swipe file", hint: "Everything saved", glyph: "▣" },
  { href: "/playbook", label: "Playbook", hint: "What works in your niche", glyph: "◈" },
  { href: "/settings", label: "Settings", hint: "Providers and brand", glyph: "⚙" },
];

const STORAGE_KEY = "adclone.sidebar";

/**
 * Collapsed state is per-viewer browser state, so it is read through
 * useSyncExternalStore rather than an effect: hydration-safe via the explicit
 * server snapshot, and no setState during commit.
 */
const listeners = new Set<() => void>();

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    // Private window, blocked site data, or a sandboxed frame.
    return false;
  }
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  window.addEventListener("storage", onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

export function Sidebar() {
  const pathname = usePathname();

  const collapsed = React.useSyncExternalStore(
    subscribe,
    readCollapsed,
    () => false,
  );

  function toggle() {
    try {
      localStorage.setItem(STORAGE_KEY, collapsed ? "0" : "1");
    } catch {
      /* not worth surfacing — the nav still works */
    }
    for (const listener of listeners) listener();
  }

  return (
    <nav
      aria-label="Sections"
      className="panel shrink-0 flex flex-col sticky top-0 h-dvh z-20"
      style={{ width: collapsed ? 52 : 190 }}
    >
      <div className="panel-header" style={{ padding: collapsed ? "8px 0" : undefined }}>
        {!collapsed && <span className="panel-title">AdClone</span>}
        <button
          type="button"
          className="btn btn-sm mx-auto"
          onClick={toggle}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          title={collapsed ? "Expand" : "Collapse"}
        >
          {collapsed ? "»" : "«"}
        </button>
      </div>

      <ul className="flex flex-col p-1.5 gap-0.5">
        {ITEMS.map((item) => {
          const active =
            item.href === "/"
              ? pathname === "/"
              : pathname.startsWith(item.href);

          return (
            <li key={item.href}>
              <Link
                href={item.href}
                title={collapsed ? `${item.label} — ${item.hint}` : item.hint}
                aria-current={active ? "page" : undefined}
                className="flex items-center gap-2 px-2 py-1.5 border transition-colors"
                style={{
                  background: active ? "var(--brand)" : "transparent",
                  borderColor: active ? "transparent" : "var(--rule)",
                  color: active ? "#1a1030" : "var(--ink-2)",
                  justifyContent: collapsed ? "center" : undefined,
                }}
              >
                <span aria-hidden className="text-[12px] leading-none">
                  {item.glyph}
                </span>
                {!collapsed && (
                  <span className="text-[12px] font-medium truncate">
                    {item.label}
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>

      {!collapsed && (
        <div className="mt-auto p-2.5 border-t border-[var(--rule)]">
          <p className="t-label normal-case tracking-normal">
            Reads public ads and writes original derivative copy. The originality
            check is enforced in code.
          </p>
        </div>
      )}
    </nav>
  );
}
