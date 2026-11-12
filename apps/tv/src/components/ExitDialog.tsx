import { FocusContext, setFocus, useFocusable } from "@noriginmedia/norigin-spatial-navigation";
import { useEffect, useRef } from "react";
import { exitApp } from "../host";
import { useLocale } from "../i18n";
import { remoteAction } from "../remote";
import { Focusable } from "./Focusable";

/** "Leave Kinora?" on Home. Focus stays inside until it is answered; Back answers "stay". */
export function ExitDialog(props: { onClose: () => void }) {
  const { t } = useLocale();
  const { ref, focusKey } = useFocusable({ focusKey: "exit-dialog", isFocusBoundary: true, trackChildren: true });
  const close = useRef(props.onClose);
  close.current = props.onClose;

  useEffect(() => {
    setFocus("exit-stay");
    const onKey = (event: KeyboardEvent) => {
      if (remoteAction(event) !== "back") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      close.current();
    };
    // Capture, so the Shell's own Back handler does not reopen the dialog in the same keypress.
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      setFocus("nav-home");
    };
  }, []);

  return (
    <FocusContext.Provider value={focusKey}>
      <div className="exit-scrim" role="dialog" aria-modal="true" aria-label={t.exitTitle}>
        <div className="exit-card" ref={ref}>
          <h2>{t.exitTitle}</h2>
          <p className="hint">{t.exitHelp}</p>
          <div className="hero-actions">
            <Focusable className="btn primary" focusKey="exit-stay" onEnterPress={() => close.current()}>
              {t.exitStay}
            </Focusable>
            <Focusable className="btn" focusKey="exit-leave" onEnterPress={exitApp}>
              {t.exitLeave}
            </Focusable>
          </div>
        </div>
      </div>
    </FocusContext.Provider>
  );
}
