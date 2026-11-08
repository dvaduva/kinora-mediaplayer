import { useEffect, useState, type ComponentType } from "react";
import { Link, Navigate, useBlocker, useParams } from "react-router-dom";
import type { AppSettings } from "@kinora/shared";
import { api } from "../api";
import { useLocale, type Copy } from "../i18n";
import { Dialog } from "../movieExtras";
import { Icon } from "../ui";
import type { SectionProps } from "./settings/common";
import { LibrariesSection } from "./settings/LibrariesSection";
import { MetadataSection } from "./settings/MetadataSection";
import { NetworkSection } from "./settings/NetworkSection";
import { PlaybackSection } from "./settings/PlaybackSection";
import { StorageSection } from "./settings/StorageSection";
import { SystemSection } from "./settings/SystemSection";

type SectionId = "libraries" | "playback" | "metadata" | "network" | "storage" | "system";

const SECTIONS: {
  id: SectionId;
  icon: "folder" | "captions" | "tag" | "network" | "storage" | "system";
  title: (t: Copy) => string;
  help: (t: Copy) => string;
  view: ComponentType<SectionProps>;
}[] = [
  { id: "libraries", icon: "folder", title: (t) => t.settingsLibraries, help: (t) => t.settingsLibrariesHelp, view: LibrariesSection },
  { id: "playback", icon: "captions", title: (t) => t.settingsPlayback, help: (t) => t.settingsPlaybackHelp, view: PlaybackSection },
  { id: "metadata", icon: "tag", title: (t) => t.settingsMetadata, help: (t) => t.settingsMetadataHelp, view: MetadataSection },
  { id: "network", icon: "network", title: (t) => t.settingsNetwork, help: (t) => t.settingsNetworkHelp, view: NetworkSection },
  { id: "storage", icon: "storage", title: (t) => t.settingsStorage, help: (t) => t.settingsStorageHelp, view: StorageSection },
  { id: "system", icon: "system", title: (t) => t.settingsSystem, help: (t) => t.settingsSystemHelp, view: SystemSection },
];

/** `/settings` and `/settings/libraries` show the same section; anything outside settings is its own page. */
function openSection(pathname: string) {
  const path = pathname.replace(/\/+$/, "");
  return path === "/settings" ? "/settings/libraries" : path;
}

/**
 * Settings as a menu and one open section. On wide screens `/settings` opens the first section beside the menu;
 * on narrow ones it shows only the menu, and a section replaces it with a way back.
 */
export function SettingsPage() {
  const { t } = useLocale();
  const { section } = useParams();
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [dirty, setDirty] = useState(false);

  // Any navigation away from a section with unsaved edits waits for an answer: menu, sidebar, search, Back.
  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && openSection(currentLocation.pathname) !== openSection(nextLocation.pathname));
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  function reload() {
    api<AppSettings>("/api/settings").then(setSettings).catch(() => undefined);
  }
  useEffect(reload, []);

  const current = SECTIONS.find((entry) => entry.id === (section ?? "libraries"));
  if (!current) return <Navigate to="/settings" replace />;

  const warnings: Partial<Record<SectionId, boolean>> = settings
    ? { system: !settings.ffmpeg || !settings.ffprobe, metadata: !settings.tmdbConfigured }
    : {};
  const View = current.view;

  return (
    <div className={`settings${section ? " has-section" : ""}`}>
      <h1 className="settings-title">{t.settings}</h1>
      <nav className="settings-nav" aria-label={t.settings}>
        {SECTIONS.map((entry) => (
          <Link
            key={entry.id}
            to={`/settings/${entry.id}`}
            className={entry.id === current.id ? "active" : undefined}
            aria-current={entry.id === current.id ? "page" : undefined}
          >
            <Icon name={entry.icon} />
            <span className="settings-nav-text">
              <span>{entry.title(t)}</span>
              <small>{entry.help(t)}</small>
            </span>
            {warnings[entry.id] ? <span className="settings-dot" aria-hidden="true" /> : null}
            <span className="settings-nav-chevron"><Icon name="chevron" /></span>
          </Link>
        ))}
      </nav>
      <div className="settings-panel">
        <Link className="settings-back" to="/settings">
          <Icon name="back" />
          {t.settingsBack}
        </Link>
        {settings ? (
          <View key={current.id} settings={settings} reload={reload} onDirty={setDirty} />
        ) : (
          <div className="settings-card">
            <span className="skeleton skeleton-line title" />
            <span className="skeleton skeleton-field" />
          </div>
        )}
      </div>
      {blocker.state === "blocked" ? (
        <Dialog label={t.leaveTitle} onClose={() => blocker.reset()} className="leave-dialog">
          <h2 className="dialog-title">{t.leaveTitle}</h2>
          <p>{t.leaveText.replace("{section}", current.title(t))}</p>
          <div className="dialog-actions">
            <button className="play" type="button" data-autofocus onClick={() => blocker.reset()}>{t.leaveStay}</button>
            <button className="text-button danger" type="button" onClick={() => blocker.proceed()}>{t.leaveDiscard}</button>
          </div>
        </Dialog>
      ) : null}
    </div>
  );
}
