"use client";

import { ChevronDown } from "lucide-react";
import { useId, useState, type ReactNode } from "react";

// Shared controls for the editor panels. Panels are 330px wide on a
// #111114 background; lime-300 is the only accent color.

export const cn = (...classes: Array<string | false | null | undefined>) =>
  classes.filter(Boolean).join(" ");

/** Title block at the top of a panel. */
export function PanelHeader({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="border-b border-white/[0.07] p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold">{title}</h2>
        {action}
      </div>
      <p className="mt-1 text-xs leading-5 text-zinc-500">{description}</p>
    </div>
  );
}

/** A collapsible group of controls. */
export function Section({
  title,
  action,
  defaultOpen = true,
  children,
}: {
  title: string;
  action?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const contentId = useId();
  return (
    <section className="border-b border-white/[0.07]">
      <div className="flex items-center justify-between gap-2 px-5 py-3.5">
        <button
          type="button"
          onClick={() => setOpen((current) => !current)}
          aria-expanded={open}
          aria-controls={contentId}
          className="flex flex-1 items-center gap-2 text-left text-xs font-semibold uppercase tracking-wider text-zinc-500 hover:text-zinc-300"
        >
          <ChevronDown
            size={14}
            className={cn("transition-transform", !open && "-rotate-90")}
          />
          {title}
        </button>
        {action}
      </div>
      {open ? (
        <div id={contentId} className="space-y-4 px-5 pb-5">
          {children}
        </div>
      ) : null}
    </section>
  );
}

export function SliderField({
  label,
  value,
  min,
  max,
  step = 1,
  format = (current) => String(current),
  disabled,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  /** Text shown for the current value, for example with a unit. */
  format?: (value: number) => string;
  disabled?: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <label className="block">
      <span className="mb-2 flex justify-between text-xs text-zinc-400">
        <span>{label}</span>
        <span className="font-mono text-zinc-600">{format(value)}</span>
      </span>
      <input
        className="w-full accent-lime-300 disabled:opacity-40"
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}

/** Set on a text field that shows a document value with nothing typed over it. */
const EDITOR_UNDO = { "data-editor-undo": "" };

/**
 * Reads a typed color the way people paste them: with or without the `#`, in
 * three or six digits. Returns `#rrggbb`, or null while it is not a color yet.
 */
const parseHexColor = (text: string) => {
  const digits = text.trim().replace(/^#/, "").toLowerCase();
  if (/^[0-9a-f]{6}$/.test(digits)) return `#${digits}`;
  if (/^[0-9a-f]{3}$/.test(digits))
    return `#${[...digits].map((digit) => digit + digit).join("")}`;
  return null;
};

/** A color swatch with an editable hex value. Only reports `#rrggbb`. */
export function ColorField({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  // The draft holds what is being typed until it is a complete color.
  const [draft, setDraft] = useState<string | null>(null);
  const typed = draft === null ? value : parseHexColor(draft);
  const invalid = typed === null;
  return (
    <label className="block text-xs text-zinc-400">
      {label}
      <div
        className={cn(
          "mt-2 flex h-9 items-center gap-2 rounded-lg border px-2",
          invalid
            ? "border-red-400/60"
            : "border-white/10 focus-within:border-lime-300/50",
          disabled && "opacity-40",
        )}
      >
        <input
          type="color"
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          className="size-5 shrink-0 cursor-pointer border-0 bg-transparent p-0"
          aria-label={`${label} picker`}
        />
        <input
          type="text"
          value={draft ?? value}
          disabled={disabled}
          spellCheck={false}
          maxLength={7}
          aria-invalid={invalid}
          {...(typed === value ? EDITOR_UNDO : {})}
          onChange={(event) => {
            const next = event.target.value.trim();
            setDraft(next);
            const color = parseHexColor(next);
            if (color && color !== value) onChange(color);
          }}
          onBlur={() => setDraft(null)}
          onKeyDown={(event) => {
            if (event.key === "Enter") setDraft(null);
          }}
          className="w-full min-w-0 bg-transparent font-mono text-[11px] text-zinc-300 outline-none"
          aria-label={`${label} hex value`}
        />
      </div>
    </label>
  );
}

export function ToggleField({
  label,
  description,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  description?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0">
        <p className="text-xs text-zinc-300">{label}</p>
        {description ? (
          <p className="mt-0.5 text-[11px] leading-4 text-zinc-600">
            {description}
          </p>
        ) : null}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative h-5 w-9 shrink-0 rounded-full transition disabled:opacity-40",
          checked ? "bg-lime-300" : "bg-zinc-700",
        )}
      >
        <span
          className={cn(
            "absolute left-0 top-0.5 size-4 rounded-full bg-black transition-transform",
            checked ? "translate-x-4.5" : "translate-x-0.5",
          )}
        />
      </button>
    </div>
  );
}

/** A row of mutually exclusive choices. */
export function SegmentedControl<T extends string | number>({
  label,
  value,
  options,
  disabled,
  onChange,
}: {
  label: string;
  value: T;
  options: ReadonlyArray<{ value: T; label: ReactNode; title?: string }>;
  disabled?: boolean;
  onChange: (value: T) => void;
}) {
  const selected = options.findIndex((option) => option.value === value);
  return (
    <div>
      <p className="mb-2 text-xs text-zinc-400">{label}</p>
      <div
        role="radiogroup"
        aria-label={label}
        className="flex rounded-lg border border-white/10 p-0.5"
        // One tab stop for the group; the arrow keys move the choice.
        onKeyDown={(event) => {
          const step =
            event.key === "ArrowRight" || event.key === "ArrowDown"
              ? 1
              : event.key === "ArrowLeft" || event.key === "ArrowUp"
                ? -1
                : 0;
          if (step === 0 || disabled) return;
          event.preventDefault();
          const next =
            options[
              (Math.max(0, selected) + step + options.length) % options.length
            ];
          if (!next) return;
          onChange(next.value);
          const buttons =
            event.currentTarget.querySelectorAll<HTMLElement>("[role=radio]");
          buttons[options.indexOf(next)]?.focus();
        }}
      >
        {options.map((option, index) => (
          <button
            key={String(option.value)}
            type="button"
            role="radio"
            aria-checked={option.value === value}
            tabIndex={index === Math.max(0, selected) ? 0 : -1}
            title={option.title}
            disabled={disabled}
            onClick={() => onChange(option.value)}
            className={cn(
              "flex h-7 flex-1 items-center justify-center gap-1 rounded-md px-1 text-[11px] font-medium transition disabled:opacity-40",
              option.value === value
                ? "bg-lime-300/15 text-lime-300"
                : "text-zinc-500 hover:text-zinc-200",
            )}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function SelectField<T extends string | number>({
  label,
  value,
  options,
  disabled,
  onChange,
}: {
  label: string;
  value: T;
  options: ReadonlyArray<{ value: T; label: string; group?: string }>;
  disabled?: boolean;
  onChange: (value: T) => void;
}) {
  const groups = [...new Set(options.map((option) => option.group ?? ""))];
  const render = (option: { value: T; label: string }) => (
    <option key={String(option.value)} value={String(option.value)}>
      {option.label}
    </option>
  );
  return (
    <label className="block text-xs text-zinc-400">
      {label}
      <select
        value={String(value)}
        disabled={disabled}
        onChange={(event) => {
          const picked = options.find(
            (option) => String(option.value) === event.target.value,
          );
          if (picked) onChange(picked.value);
        }}
        className="mt-2 h-9 w-full rounded-lg border border-white/10 bg-[#17171b] px-2 text-xs text-zinc-200 outline-none focus:border-lime-300/50 disabled:opacity-40"
      >
        {groups.map((group) =>
          group ? (
            <optgroup key={group} label={group}>
              {options.filter((option) => option.group === group).map(render)}
            </optgroup>
          ) : (
            options.filter((option) => !option.group).map(render)
          ),
        )}
      </select>
    </label>
  );
}

/** A small square button holding one icon. */
export function IconButton({
  label,
  active,
  disabled,
  onClick,
  children,
}: {
  /** Read by screen readers and shown as the tooltip. */
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "grid size-7 shrink-0 place-items-center rounded-md transition disabled:cursor-default disabled:opacity-30",
        active
          ? "bg-lime-300/15 text-lime-300"
          : "text-zinc-500 hover:bg-white/5 hover:text-zinc-200",
      )}
    >
      {children}
    </button>
  );
}

/** Shown in place of a panel's content when there is nothing to edit yet. */
export function EmptyState({
  icon,
  title,
  description,
}: {
  icon: ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="flex flex-col items-center px-8 py-14 text-center">
      <div className="grid size-11 place-items-center rounded-xl border border-white/10 text-zinc-500">
        {icon}
      </div>
      <p className="mt-4 text-sm font-medium text-zinc-300">{title}</p>
      <p className="mt-1.5 text-xs leading-5 text-zinc-600">{description}</p>
    </div>
  );
}

export const formatTime = (seconds: number) => {
  const safe = Math.max(0, seconds);
  return `${Math.floor(safe / 60)}:${Math.floor(safe % 60)
    .toString()
    .padStart(2, "0")}`;
};

/** Like formatTime, with hundredths of a second: `0:04.25`. */
export const formatPreciseTime = (seconds: number) => {
  const safe = Math.max(0, seconds);
  return `${Math.floor(safe / 60)}:${(safe % 60).toFixed(2).padStart(5, "0")}`;
};
