import type { LiveChannel } from "@kinora/shared";
import { categoryLabel, channelCategories, sameFilter, saveFavorite, type ChannelFilter } from "@kinora/client";
import type { Copy } from "./i18n";
import { Icon, ScrollRail } from "./ui";

/** Where the web app remembers the picked guide filter. */
export const LIVE_FILTER_KEY = "kinora.liveFilter";

/** Favorites, All and the categories in use; a remembered category that has no channels left falls back to All. */
export function CategoryBar(props: { channels: Pick<LiveChannel, "category">[]; filter: ChannelFilter; onChange: (filter: ChannelFilter) => void; t: Copy }) {
  const { t, filter } = props;
  const categories = channelCategories(props.channels, t);
  const is = (other: ChannelFilter) => sameFilter(other, filter);
  const tabs: { filter: ChannelFilter; label: string }[] = [
    { filter: { kind: "favorites" }, label: t.liveFavorites },
    { filter: { kind: "all" }, label: t.liveAll },
    ...categories.map((value) => ({ filter: { kind: "category", value } as ChannelFilter, label: categoryLabel(value, t) })),
  ];
  return (
    <div className="live-category-rail" role="group" aria-label={t.liveCategories}>
      <ScrollRail className="live-categories">
        {tabs.map((tab) => (
          <button key={tab.filter.kind === "category" ? `c:${tab.filter.value}` : tab.filter.kind} type="button" className={is(tab.filter) ? "active" : undefined} aria-pressed={is(tab.filter)} onClick={() => props.onChange(tab.filter)}>
            {tab.filter.kind === "favorites" ? <Icon name="star" /> : null}
            {tab.label}
          </button>
        ))}
      </ScrollRail>
    </div>
  );
}

/** Star toggle; `onChange` gets the new state at once and again with the server's answer. */
export function FavoriteButton(props: { channel: Pick<LiveChannel, "id" | "favorite" | "name">; t: Copy; onChange: (favorite: boolean) => void; className?: string }) {
  const { channel, t } = props;
  const label = channel.favorite ? t.liveFavoriteRemove : t.liveFavoriteAdd;
  return (
    <button
      type="button"
      className={`favorite-button${channel.favorite ? " on" : ""}${props.className ? ` ${props.className}` : ""}`}
      aria-pressed={channel.favorite}
      aria-label={`${label}: ${channel.name}`}
      title={label}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        const next = !channel.favorite;
        props.onChange(next);
        saveFavorite(channel.id, next)
          .then((saved) => props.onChange(saved.favorite))
          .catch(() => props.onChange(!next));
      }}
    >
      <Icon name="star" />
    </button>
  );
}
