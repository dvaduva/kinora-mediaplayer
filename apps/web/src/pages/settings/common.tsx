import { useEffect, useRef, useState, type ReactNode } from "react";
import type { AppSettings } from "@kinora/shared";
import type { Copy } from "../../i18n";

export type SectionProps = { settings: AppSettings; reload: () => void; onDirty: (dirty: boolean) => void };

/** Tells the settings page whether this section holds edits that would be lost by leaving it. */
export function useReportDirty(onDirty: (dirty: boolean) => void, dirty: boolean) {
  const report = useRef(onDirty);
  report.current = onDirty;
  useEffect(() => report.current(dirty), [dirty]);
  useEffect(() => () => report.current(false), []);
}

export function SectionHead(props: { title: string; help: string; children?: ReactNode }) {
  return (
    <header className="settings-head">
      <div>
        <h2>{props.title}</h2>
        <p className="muted">{props.help}</p>
      </div>
      {props.children}
    </header>
  );
}

export function Status(props: { tone: "ok" | "warn" | "busy" | "error"; children: ReactNode }) {
  return <span className={`settings-status ${props.tone}`}>{props.children}</span>;
}

type SaveState = { kind: "idle" | "saving" | "saved" | "error"; text?: string };

/** Runs a section's save and keeps the outcome to show next to its button. */
export function useSave(t: Copy) {
  const [state, setState] = useState<SaveState>({ kind: "idle" });
  async function run(task: () => Promise<string | void>) {
    setState({ kind: "saving" });
    try {
      const text = await task();
      setState({ kind: "saved", text: text || t.saved });
    } catch (reason) {
      setState({ kind: "error", text: errorText(t, reason) });
    }
  }
  return { state, run };
}

/** The footer of a card: the save button, plus what happened last time or that edits are pending. */
export function SaveRow(props: { t: Copy; dirty: boolean; state: SaveState }) {
  const { t, dirty, state } = props;
  const saving = state.kind === "saving";
  let note: ReactNode = null;
  if (saving) note = <span className="muted">{t.saving}</span>;
  else if (state.kind === "error") note = <span className="danger" role="alert">{state.text}</span>;
  else if (dirty) note = <span className="muted">{t.unsaved}</span>;
  else if (state.kind === "saved") note = <span className="settings-saved" role="status">{state.text}</span>;
  return (
    <div className="settings-foot">
      {note}
      <button className="play" type="submit" disabled={!dirty || saving}>{t.save}</button>
    </div>
  );
}

export function errorText(t: Copy, reason: unknown) {
  const code = reason instanceof Error ? reason.message : "error";
  if (code === "token_required") return t.errTokenRequired;
  if (code === "bad_omdb_key") return t.errBadOmdb;
  if (code === "bad_cache_limit") return t.errBadCache;
  if (code === "folder_not_found") return t.errFolderNotFound;
  if (code === "folder_unreadable") return t.errFolderUnreadable;
  if (code === "folder_not_absolute") return t.errFolderNotAbsolute;
  return code;
}
