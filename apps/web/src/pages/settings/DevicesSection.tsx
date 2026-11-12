import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import type { DevicePlatform, DeviceView } from "@kinora/shared";
import { api } from "@kinora/client";
import { useLocale, type Copy } from "../../i18n";
import { SectionHead, Status, errorText } from "./common";

export function platformLabel(t: Copy, platform: DevicePlatform) {
  if (platform === "tizen") return t.platformTizen;
  if (platform === "webos") return t.platformWebos;
  if (platform === "android") return t.platformAndroid;
  return t.platformBrowser;
}

function when(locale: string, value: number) {
  return new Intl.DateTimeFormat(locale === "ro" ? "ro-RO" : "en-GB", { dateStyle: "medium", timeStyle: "short" }).format(value);
}

/** Paired TVs: each has its own token, so one can be renamed or cut off without touching the others. */
export function DevicesSection() {
  const { t } = useLocale();
  const [devices, setDevices] = useState<DeviceView[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  function reload() {
    api<DeviceView[]>("/api/devices")
      .then((list) => {
        setDevices(list);
        setError(null);
      })
      .catch((reason: unknown) => setError(errorText(t, reason)));
  }
  useEffect(reload, []);

  return (
    <section className="settings-section">
      <SectionHead title={t.settingsDevices} help={t.settingsDevicesHelp}>
        <Link className="play" to="/pair">{t.pairDevice}</Link>
      </SectionHead>
      {error ? <p className="danger" role="alert">{error}</p> : null}
      {devices && devices.length === 0 ? (
        <div className="settings-card">
          <p className="muted">{t.noDevices}</p>
        </div>
      ) : null}
      <div className="library-list">
        {devices?.map((device) => <DeviceCard key={device.id} device={device} onChange={reload} />)}
      </div>
    </section>
  );
}

function DeviceCard(props: { device: DeviceView; onChange: () => void }) {
  const { t, locale } = useLocale();
  const { device } = props;
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(device.name);
  const [confirming, setConfirming] = useState<"revoke" | "delete" | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  async function run(task: () => Promise<unknown>) {
    setFailed(null);
    try {
      await task();
      props.onChange();
    } catch (reason) {
      setFailed(errorText(t, reason));
    }
  }

  function rename(event: FormEvent) {
    event.preventDefault();
    if (!name.trim() || name.trim() === device.name) {
      setEditing(false);
      return;
    }
    void run(async () => {
      await api(`/api/devices/${device.id}`, { method: "PUT", body: JSON.stringify({ name }) });
      setEditing(false);
    });
  }

  const revoked = device.revokedAt != null;
  return (
    <article className="settings-card library-card">
      {editing ? (
        <form className="device-rename" onSubmit={rename}>
          <label className="field">
            {t.deviceName}
            <input value={name} onChange={(event) => setName(event.target.value)} maxLength={60} autoFocus />
          </label>
          <button className="text-button" type="button" onClick={() => { setName(device.name); setEditing(false); }}>{t.cancel}</button>
          <button className="play" type="submit">{t.save}</button>
        </form>
      ) : (
        <div className="library-card-head">
          <h3>{device.name}</h3>
          <span className="library-type">{platformLabel(t, device.platform)}</span>
        </div>
      )}
      <p className="field-help">
        {t.devicePaired} {when(locale, device.createdAt)}
        {" · "}
        {device.lastSeenAt != null ? `${t.deviceSeen} ${when(locale, device.lastSeenAt)}` : t.deviceNeverSeen}
      </p>
      {failed ? <p className="danger" role="alert">{failed}</p> : null}
      <div className="library-card-foot">
        {revoked ? <Status tone="error">{t.deviceRevoked} {when(locale, device.revokedAt!)}</Status> : <Status tone="ok">{t.deviceActive}</Status>}
        <span className="spacer" />
        {confirming ? (
          <>
            <button className="text-button" type="button" onClick={() => setConfirming(null)}>{t.cancel}</button>
            <button
              className="text-button danger"
              type="button"
              onClick={() =>
                void run(() =>
                  confirming === "revoke"
                    ? api(`/api/devices/${device.id}/revoke`, { method: "POST" })
                    : api(`/api/devices/${device.id}`, { method: "DELETE" }),
                ).then(() => setConfirming(null))
              }
            >
              {confirming === "revoke" ? t.confirmRevoke : t.confirmRemove}
            </button>
          </>
        ) : (
          <>
            {editing || revoked ? null : (
              <button className="text-button" type="button" onClick={() => setEditing(true)}>{t.rename}</button>
            )}
            {revoked ? (
              <button className="text-button danger" type="button" onClick={() => setConfirming("delete")}>{t.deviceRemove}</button>
            ) : (
              <button className="text-button danger" type="button" onClick={() => setConfirming("revoke")}>{t.revoke}</button>
            )}
          </>
        )}
      </div>
    </article>
  );
}
