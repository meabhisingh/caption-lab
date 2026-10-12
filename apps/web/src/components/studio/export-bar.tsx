"use client";

import { Download, LoaderCircle } from "lucide-react";
import { useStudio } from "./studio-context";

const BUTTON =
  "flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-lime-300 text-sm font-bold text-black transition hover:bg-lime-200 disabled:cursor-not-allowed disabled:bg-zinc-800 disabled:text-zinc-500";

/** The export button pinned to the bottom of the sidebar. */
export function ExportBar() {
  const { project, ready, exportOverlay, saveExport } = useStudio();
  const exporting = project.status === "EXPORTING";
  const finished = project.status === "COMPLETE" && Boolean(project.exportUrl);
  const progress = Math.min(100, Math.max(0, project.renderProgress));

  return (
    <div className="shrink-0 border-t border-white/[0.07] bg-[#111114] p-4">
      {finished && saveExport ? (
        <button
          type="button"
          onClick={() => void saveExport()}
          className={BUTTON}
        >
          <Download size={16} /> Save WebM
        </button>
      ) : finished && project.exportUrl ? (
        <a href={project.exportUrl} className={BUTTON}>
          <Download size={16} /> Download WebM
        </a>
      ) : (
        <button
          type="button"
          disabled={!ready || exporting}
          onClick={() => void exportOverlay()}
          className={BUTTON}
        >
          {exporting ? (
            <LoaderCircle className="animate-spin" size={16} />
          ) : (
            <Download size={16} />
          )}
          {exporting
            ? `Rendering overlay · ${project.renderProgress}%`
            : "Export transparent WebM"}
        </button>
      )}
      {exporting ? (
        <div
          className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/[0.08]"
          role="progressbar"
          aria-label="Render progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progress}
        >
          <div
            className="h-full rounded-full bg-lime-300 transition-[width] duration-500 ease-out"
            style={{ width: `${progress}%` }}
          />
        </div>
      ) : null}
      <p className="mt-2 text-center text-[10px] text-zinc-600">
        {finished
          ? "Any edit makes the overlay ready to export again"
          : "VP9 alpha · 1080 × 1920 · no background"}
      </p>
    </div>
  );
}
