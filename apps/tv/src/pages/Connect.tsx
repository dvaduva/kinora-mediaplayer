import { useState, type FormEvent } from "react";
import type { AppSetup, HomeView } from "@kinora/shared";
import { api, createSession, setConnection } from "../api";
import { Focusable } from "../components/Focusable";
import { loadConnection, normalizeBaseUrl, saveConnection } from "../connection";
import { useLocale } from "../i18n";

type Props = {
  onConnected: () => void;
};

export function ConnectPage(props: Props) {
  const { t } = useLocale();
  const saved = loadConnection();
  const [baseUrl, setBaseUrl] = useState(saved.baseUrl);
  const [token, setToken] = useState(saved.token);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event?: FormEvent) {
    event?.preventDefault();
    setBusy(true);
    setError(null);
    const next = {
      baseUrl: normalizeBaseUrl(baseUrl),
      token: token.trim(),
    };
    setConnection(next);
    try {
      const setup = await api<AppSetup>("/api/setup");
      if (setup.tokenRequired) {
        if (!next.token) throw new Error("token_required");
        if (!next.baseUrl) await createSession(next.token);
      }
      await api<HomeView>("/api/home");
      saveConnection(next);
      props.onConnected();
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "failed";
      setError(message === "unauthorized" || message === "token_required" ? t.errWrongKey : t.errUnreachable);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="connect">
      <div className="connect-card">
        <p className="eyebrow">Kinora TV</p>
        <h1>{t.connectTitle}</h1>
        <p className="lede">{t.connectLede}</p>
        <form className="connect-form" onSubmit={submit}>
          <label>
            {t.serverAddress}
            <input
              value={baseUrl}
              onChange={(event) => setBaseUrl(event.target.value)}
              placeholder="http://192.168.1.20:3001"
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          <label>
            {t.accessKey}
            <input
              value={token}
              onChange={(event) => setToken(event.target.value)}
              placeholder={t.accessKeyPlaceholder}
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          {error ? <p className="error">{error}</p> : null}
          <Focusable className="connect-submit" focusOnMount onEnterPress={() => void submit()}>
            <button type="submit" disabled={busy}>
              {busy ? t.connecting : t.connect}
            </button>
          </Focusable>
        </form>
      </div>
    </div>
  );
}
