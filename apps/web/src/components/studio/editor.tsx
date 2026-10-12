"use client";

import { Film, Redo2, Undo2 } from "lucide-react";
import { Activity } from "react";
import { ExportBar } from "./export-bar";
import { AudioPanel } from "./panels/audio-panel";
import { EditPanel } from "./panels/edit-panel";
import { LayersPanel } from "./panels/layers-panel";
import { TextPanel } from "./panels/text-panel";
import { PreviewStage } from "./preview-stage";
import { useStudio, type StudioTab } from "./studio-context";
import { Timeline } from "./timeline";
import { STUDIO_TABS, ToolRail, studioPanelId, studioTabId } from "./tool-rail";
import { IconButton } from "./ui";

const PANELS: Record<StudioTab, () => React.ReactNode> = {
  edit: EditPanel,
  text: TextPanel,
  layers: LayersPanel,
  audio: AudioPanel,
};

function SaveIndicator() {
  const { saveState, saveError, retrySave, locked } = useStudio();
  if (locked)
    return (
      <span className="flex items-center gap-2">
        <span className="size-1.5 rounded-full bg-amber-300" /> Editing paused
        while exporting
      </span>
    );
  if (saveState === "error")
    return (
      <button
        type="button"
        onClick={retrySave}
        title={saveError ?? undefined}
        className="flex items-center gap-2 text-red-300 hover:text-red-200"
      >
        <span className="size-1.5 rounded-full bg-red-400" /> Not saved · Retry
      </button>
    );
  return (
    <span className="flex items-center gap-2">
      <span
        className={`size-1.5 rounded-full ${saveState === "saved" ? "bg-lime-300" : "bg-amber-300"}`}
      />
      {saveState === "saved" ? "Saved" : "Saving…"}
    </span>
  );
}

/** The workspace below the header: tools, canvas, timeline and sidebar. */
export function StudioEditor() {
  const { project, activeTab, undo, redo, canUndo, canRedo } = useStudio();
  return (
    <div className="flex min-h-0 flex-1">
      <ToolRail />
      <section className="flex min-w-0 flex-1 flex-col bg-[#0d0d10]">
        <div className="flex h-12 shrink-0 items-center justify-between gap-4 border-b border-white/[0.07] px-5 text-xs text-zinc-500">
          <div className="flex min-w-0 items-center gap-2">
            <Film size={14} className="shrink-0" />
            <span className="truncate">{project.fileName}</span>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <SaveIndicator />
            <div className="flex items-center gap-0.5">
              <IconButton
                label="Undo (Ctrl+Z)"
                disabled={!canUndo}
                onClick={undo}
              >
                <Undo2 size={15} />
              </IconButton>
              <IconButton
                label="Redo (Ctrl+Shift+Z)"
                disabled={!canRedo}
                onClick={redo}
              >
                <Redo2 size={15} />
              </IconButton>
            </div>
          </div>
        </div>
        <PreviewStage />
        <Timeline />
      </section>
      <aside className="flex w-[330px] shrink-0 flex-col border-l border-white/[0.07] bg-[#111114]">
        {/* Every panel stays mounted so it keeps its state across tabs. Each
            scroller is positioned so nothing absolute inside can escape it. */}
        {STUDIO_TABS.map(({ id }) => {
          const Panel = PANELS[id];
          return (
            <Activity key={id} mode={id === activeTab ? "visible" : "hidden"}>
              <div
                id={studioPanelId(id)}
                role="tabpanel"
                aria-labelledby={studioTabId(id)}
                className="relative min-h-0 flex-1 overflow-y-auto"
              >
                <Panel />
              </div>
            </Activity>
          );
        })}
        <ExportBar />
      </aside>
    </div>
  );
}
