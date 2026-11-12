import { useEffect, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { normalizePairCode, PAIR_CODE_LENGTH, type DevicePlatform, type DeviceView } from "@kinora/shared";
import { api } from "@kinora/client";
import { useLocale } from "../i18n";
import { platformLabel } from "./settings/DevicesSection";

type PairInfo = { name: string; platform: DevicePlatform; expiresAt: number };

/**
 * Approves a TV: the code it shows is typed here, or arrives in the URL from its QR code (`/pair?code=…`).
 * The page sits behind the access key like the rest of the UI, so only a signed-in user can let a device in.
 */
export function PairPage() {
  const { t } = useLocale();
  const [params, setParams] = useSearchParams();
  const [typed, setTyped] = useState(params.get("code") ?? "");
  const code = normalizePairCode(typed);
  const [info, setInfo] = useState<PairInfo | null>(null);
  const [name, setName] = useState("");
  const [state, setState] = useState<"idle" | "looking" | "missing" | "approving" | "failed">("idle");
  const [paired, setPaired] = useState<DeviceView | null>(null);

  useEffect(() => {
    setInfo(null);
    if (!code) {
      setState("idle");
      return;
    }
    let cancelled = false;
    setState("looking");
    api<PairInfo>(`/api/pair/${code}/info`)
      .then((found) => {
        if (cancelled) return;
        setInfo(found);
        setName(found.name);
        setState("idle");
      })
      .catch(() => {
        if (!cancelled) setState("missing");
      });
    return () => {
      cancelled = true;
    };
  }, [code]);

  function approve(event: FormEvent) {
    event.preventDefault();
    if (!code || !info) return;
    setState("approving");
    api<{ device: DeviceView }>(`/api/pair/${code}/approve`, { method: "POST", body: JSON.stringify({ name }) })
      .then((result) => {
        setPaired(result.device);
        setParams({}, { replace: true });
      })
      .catch(() => setState("failed"));
  }

  if (paired) {
    return (
      <section className="pair-page">
        <h1>{t.pairDone}</h1>
        <div className="settings-card">
          <p>{t.pairDoneText.replace("{name}", paired.name)}</p>
          <div className="settings-foot">
            <button
              className="text-button"
              type="button"
              onClick={() => {
                setPaired(null);
                setTyped("");
                setState("idle");
              }}
            >
              {t.pairAnother}
            </button>
            <Link className="play" to="/settings/devices">{t.settingsDevices}</Link>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="pair-page">
      <h1>{t.pairDevice}</h1>
      <p className="muted">{t.pairHelp}</p>
      <form className="settings-card" onSubmit={approve}>
        <label className="field">
          {t.pairCode}
          <input
            className="pair-code"
            value={typed}
            onChange={(event) => setTyped(event.target.value.toUpperCase())}
            maxLength={PAIR_CODE_LENGTH + 2}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            autoFocus
            placeholder="ABC123"
          />
        </label>
        {state === "looking" ? <p className="muted">{t.pairLooking}</p> : null}
        {state === "missing" ? <p className="danger" role="alert">{t.pairMissing}</p> : null}
        {info ? (
          <>
            <p>{t.pairAsk.replace("{platform}", platformLabel(t, info.platform))}</p>
            <label className="field">
              {t.deviceName}
              <input value={name} onChange={(event) => setName(event.target.value)} maxLength={60} />
            </label>
          </>
        ) : null}
        {state === "failed" ? <p className="danger" role="alert">{t.pairFailed}</p> : null}
        <div className="settings-foot">
          <button className="play" type="submit" disabled={!info || !name.trim() || state === "approving"}>
            {t.pairApprove}
          </button>
        </div>
      </form>
    </section>
  );
}
