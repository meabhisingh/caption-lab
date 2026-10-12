"use client";

import { Layers3, Music2, Scissors, Type } from "lucide-react";
import { useStudio, type StudioTab } from "./studio-context";
import { cn } from "./ui";

export const STUDIO_TABS: ReadonlyArray<{
  id: StudioTab;
  label: string;
  icon: typeof Type;
}> = [
  { id: "edit", label: "Edit", icon: Scissors },
  { id: "text", label: "Text", icon: Type },
  { id: "layers", label: "Layers", icon: Layers3 },
  { id: "audio", label: "Audio", icon: Music2 },
];

export const studioPanelId = (tab: StudioTab) => `studio-panel-${tab}`;
export const studioTabId = (tab: StudioTab) => `studio-tab-${tab}`;

/** The vertical tab strip that picks which panel the sidebar shows. */
export function ToolRail() {
  const { activeTab, setActiveTab } = useStudio();
  return (
    <nav
      role="tablist"
      aria-label="Editor tools"
      aria-orientation="vertical"
      className="w-[76px] shrink-0 border-r border-white/[0.07] bg-[#111114] py-4"
      onKeyDown={(event) => {
        if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
        event.preventDefault();
        const index = STUDIO_TABS.findIndex((tab) => tab.id === activeTab);
        const step = event.key === "ArrowDown" ? 1 : -1;
        const next =
          STUDIO_TABS[(index + step + STUDIO_TABS.length) % STUDIO_TABS.length];
        if (!next) return;
        setActiveTab(next.id);
        document.getElementById(studioTabId(next.id))?.focus();
      }}
    >
      {STUDIO_TABS.map(({ id, label, icon: Icon }) => {
        const selected = id === activeTab;
        return (
          <button
            key={id}
            id={studioTabId(id)}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-controls={studioPanelId(id)}
            tabIndex={selected ? 0 : -1}
            onClick={() => setActiveTab(id)}
            className={cn(
              "mx-auto mb-2 flex w-14 flex-col items-center gap-1.5 rounded-xl py-3 text-[10px] transition",
              selected
                ? "bg-lime-300/10 text-lime-300"
                : "text-zinc-600 hover:bg-white/5 hover:text-zinc-300",
            )}
          >
            <Icon size={18} />
            <span>{label}</span>
          </button>
        );
      })}
    </nav>
  );
}
