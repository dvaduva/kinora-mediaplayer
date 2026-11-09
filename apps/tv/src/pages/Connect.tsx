import { useState, type FormEvent } from "react";
import type { AppSetup, HomeView } from "@kinora/shared";
import { api, createSession, setConnection } from "../api";
import { Focusable } from "../components/Focusable";
import { loadConnection, normalizeBaseUrl, saveConnection } from "../connection";

type Props = {
  onConnected: () => void;
};

export function ConnectPage(props: Props) {
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
      setError(
        message === "unauthorized" || message === "token_required"
          ? "Cheia de acces este greșită sau lipsește."
          : "Nu pot contacta serverul. Verifică adresa și că Kinora ascultă în rețea.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="connect">
      <div className="connect-card">
        <p className="eyebrow">Kinora TV</p>
        <h1>Conectează televizorul</h1>
        <p className="lede">
          Lasă adresa goală când deschizi <code>/tv</code> de pe același server. Altfel introdu IP-ul Kinora din rețeaua
          ta locală.
        </p>
        <form className="connect-form" onSubmit={submit}>
          <label>
            Adresa serverului
            <input
              value={baseUrl}
              onChange={(event) => setBaseUrl(event.target.value)}
              placeholder="http://192.168.1.20:3001"
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          <label>
            Cheie de acces
            <input
              value={token}
              onChange={(event) => setToken(event.target.value)}
              placeholder="opțional dacă nu e configurată"
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          {error ? <p className="error">{error}</p> : null}
          <Focusable className="connect-submit" focusOnMount onEnterPress={() => void submit()}>
            <button type="submit" disabled={busy}>
              {busy ? "Se conectează…" : "Conectează"}
            </button>
          </Focusable>
        </form>
      </div>
    </div>
  );
}
