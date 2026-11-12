import { useNavigate } from "react-router-dom";
import { Focusable } from "../components/Focusable";
import { clearConnection, loadConnection } from "../connection";
import { setConnection } from "../api";
import { inShell, notifyShell } from "../host";
import { useLocale } from "../i18n";

type Props = {
  onDisconnect: () => void;
};

export function SettingsPage(props: Props) {
  const { t, toggle, locale } = useLocale();
  const navigate = useNavigate();
  const connection = loadConnection();
  const shell = inShell();

  return (
    <div className="page settings-page">
      <header className="page-head">
        <h1>{t.settings}</h1>
      </header>
      <p className="lede">{t.settingsHelp}</p>

      <section className="settings-block">
        <h2>{t.connection}</h2>
        <p className="hint">{connection.baseUrl || window.location.origin}</p>
        <div className="hero-actions">
          <Focusable
            className="btn"
            focusKey="settings-disconnect"
            onEnterPress={() => {
              // In the TV shell the device keeps its pairing; the shell shows the server list.
              if (notifyShell("change-server")) return;
              clearConnection();
              setConnection({ baseUrl: "", token: "" });
              props.onDisconnect();
            }}
          >
            {shell ? t.changeServer : t.disconnect}
          </Focusable>
        </div>
        <p className="hint">{shell ? t.changeServerHelp : t.disconnectHelp}</p>
      </section>

      <section className="settings-block">
        <h2>{t.language}</h2>
        <div className="hero-actions">
          <Focusable className="btn primary" focusKey="settings-locale" focusOnMount onEnterPress={toggle}>
            {locale === "ro" ? "Română → English" : "English → Română"}
          </Focusable>
        </div>
      </section>

      <section className="settings-block">
        <h2>{t.identify}</h2>
        <p className="hint">{t.openWeb}</p>
        <div className="hero-actions">
          <Focusable className="btn" focusKey="settings-identify" onEnterPress={() => navigate("/identify")}>
            {t.identify}
          </Focusable>
          <Focusable className="btn" focusKey="settings-back" onEnterPress={() => navigate(-1)}>
            {t.back}
          </Focusable>
        </div>
      </section>
    </div>
  );
}
