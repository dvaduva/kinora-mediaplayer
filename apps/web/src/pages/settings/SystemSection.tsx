import { useLocale } from "../../i18n";
import { SectionHead, Status, type SectionProps } from "./common";

export function SystemSection({ settings }: SectionProps) {
  const { t } = useLocale();
  const tools = [
    { name: "ffmpeg", found: settings.ffmpeg, missing: t.ffmpegMissing },
    { name: "ffprobe", found: settings.ffprobe, missing: t.ffprobeMissing },
  ];
  return (
    <section className="settings-section">
      <SectionHead title={t.settingsSystem} help={t.settingsSystemHelp} />
      <div className="settings-card">
        {tools.map((tool) => (
          <div className="tool-row" key={tool.name}>
            <div className="tool-name">
              <code>{tool.name}</code>
              {tool.found ? <Status tone="ok">{t.toolFound}</Status> : <Status tone="warn">{t.toolMissing}</Status>}
            </div>
            {tool.found ? null : <p className="field-help">{tool.missing}</p>}
          </div>
        ))}
      </div>
    </section>
  );
}
