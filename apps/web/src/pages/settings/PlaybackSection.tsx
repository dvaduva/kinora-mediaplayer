import { useState, type FormEvent } from "react";
import { SUBTITLE_SIZES } from "@kinora/shared";
import { api } from "@kinora/client";
import { useLocale } from "../../i18n";
import { SaveRow, SectionHead, useReportDirty, useSave, type SectionProps } from "./common";

const SUBTITLE_COLORS = ["#ffffff", "#ffe36e", "#9be7ff", "#b6f3a5", "#ffb3c7"];

export function PlaybackSection({ settings, reload, onDirty }: SectionProps) {
  const { t } = useLocale();
  const [language, setLanguage] = useState(settings.subtitleLanguage);
  const [size, setSize] = useState(settings.subtitleStyle.size);
  const [color, setColor] = useState(settings.subtitleStyle.color);
  const save = useSave(t);

  const dirty =
    language !== settings.subtitleLanguage ||
    size !== settings.subtitleStyle.size ||
    color.toLowerCase() !== settings.subtitleStyle.color.toLowerCase();
  useReportDirty(onDirty, dirty);
  const sizes = SUBTITLE_SIZES.includes(size as (typeof SUBTITLE_SIZES)[number]) ? SUBTITLE_SIZES : [...SUBTITLE_SIZES, size].sort((a, b) => a - b);

  function submit(event: FormEvent) {
    event.preventDefault();
    void save.run(async () => {
      await api("/api/profile", { method: "PUT", body: JSON.stringify({ subtitleLanguage: language, subtitleSize: size, subtitleColor: color }) });
      reload();
    });
  }

  return (
    <section className="settings-section">
      <SectionHead title={t.settingsPlayback} help={t.settingsPlaybackHelp} />
      <form className="settings-card" onSubmit={submit}>
        <label className="field">
          {t.subtitles}
          <select value={language} onChange={(event) => setLanguage(event.target.value)}>
            <option value="ro">Română</option>
            <option value="en">English</option>
            <option value="off">{t.off}</option>
          </select>
        </label>

        <fieldset className="field subtitle-look">
          <legend>{t.subtitleLook}</legend>
          <div className="settings-pair">
            <label className="field">
              {t.subtitleSize}
              <select value={size} onChange={(event) => setSize(Number(event.target.value))}>
                {sizes.map((value) => <option key={value} value={value}>{value}%</option>)}
              </select>
            </label>
            <div className="field">
              <span>{t.subtitleColor}</span>
              <div className="swatches">
                {SUBTITLE_COLORS.map((swatch) => (
                  <button
                    key={swatch}
                    className="swatch"
                    type="button"
                    style={{ background: swatch }}
                    aria-label={swatch}
                    aria-pressed={color.toLowerCase() === swatch}
                    onClick={() => setColor(swatch)}
                  />
                ))}
                <input type="color" value={color} onChange={(event) => setColor(event.target.value)} aria-label={t.subtitleColor} />
              </div>
            </div>
          </div>
          <div className="cue-preview" aria-hidden="true">
            <span style={{ color, fontSize: `${(5 * size) / 100}cqh` }}>{t.subtitlePreview}</span>
          </div>
        </fieldset>

        <SaveRow t={t} dirty={dirty} state={save.state} />
      </form>
    </section>
  );
}
