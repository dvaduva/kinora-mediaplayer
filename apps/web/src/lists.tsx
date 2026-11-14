import { useState, type FormEvent } from "react";
import { NavLink } from "react-router-dom";
import { MOVIE_LIST_NAME_MAX, type MovieListChange, type MovieListRef, type MovieListSummary } from "@kinora/shared";
import { api, imageUrl } from "@kinora/client";
import { refresh, useCached } from "./cache";
import { useLocale, type Copy } from "./i18n";
import { Dialog } from "./movieExtras";

/** The profile's movie lists, by name. */
export function useMovieLists() {
  return useCached<MovieListSummary[]>("/api/lists", []);
}

/** Reloads the lists overview and every list page that is open. */
export function refreshLists() {
  refresh("/api/lists", "/api/lists/");
}

export async function createList(name: string) {
  const list = await api<MovieListRef>("/api/lists", { method: "POST", body: JSON.stringify({ name }) });
  refreshLists();
  return list;
}

export async function changeList(listId: string, change: MovieListChange) {
  await api(`/api/lists/${listId}/movies`, { method: "POST", body: JSON.stringify(change) });
  refreshLists();
}

export function listErrorText(error: unknown, t: Copy) {
  const code = error instanceof Error ? error.message : "";
  if (code === "name_taken") return t.errListNameTaken;
  if (code === "bad_name" || code === "name_too_long") return t.errListName;
  return t.errListFailed;
}

export function countLabel(count: number, t: Copy) {
  return count === 1 ? t.listCountOne : t.listCount.replace("{count}", String(count));
}

const byName = (a: MovieListRef, b: MovieListRef) => a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true });

/** "All | Lists" switch at the top of the Movies and Lists pages. */
export function MovieTabs() {
  const { t } = useLocale();
  return (
    <nav className="filter-tabs movie-tabs" aria-label={t.movies}>
      <NavLink to="/movies" end>{t.allMovies}</NavLink>
      <NavLink to="/lists">{t.lists}</NavLink>
    </nav>
  );
}

/** Up to four posters of the list in a 2×2 collage; one poster fills the card, none shows the initial. */
export function ListCover(props: { name: string; posters: (string | null)[] }) {
  const urls = props.posters.map((path) => imageUrl(path, "w185"));
  if (urls.length === 0 || urls.every((url) => !url)) {
    return (
      <div className="list-cover empty" aria-hidden="true">
        <span>{props.name.slice(0, 1).toLocaleUpperCase()}</span>
      </div>
    );
  }
  if (urls.length === 1) {
    return (
      <div className="list-cover single" aria-hidden="true">
        <img src={urls[0] ?? ""} alt="" loading="lazy" decoding="async" />
      </div>
    );
  }
  const cells = [...urls, null, null, null].slice(0, 4);
  return (
    <div className="list-cover" aria-hidden="true">
      {cells.map((url, index) => (url ? <img key={index} src={url} alt="" loading="lazy" decoding="async" /> : <i key={index} />))}
    </div>
  );
}

/** Name field and Create button; `onCreated` receives the new list. */
export function NewListForm(props: { onCreated: (list: MovieListRef) => void | Promise<void>; autoFocus?: boolean }) {
  const { t } = useLocale();
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      const list = await createList(name);
      setName("");
      await props.onCreated(list);
    } catch (reason) {
      setError(listErrorText(reason, t));
    } finally {
      setSaving(false);
    }
  };
  return (
    <form className="new-list" onSubmit={(event) => void submit(event)}>
      <input
        value={name}
        maxLength={MOVIE_LIST_NAME_MAX}
        onChange={(event) => setName(event.target.value)}
        placeholder={t.listNamePlaceholder}
        aria-label={t.listName}
        autoFocus={props.autoFocus}
        data-autofocus={props.autoFocus ? "" : undefined}
      />
      <button className="play" type="submit" disabled={!name.trim() || saving}>{t.create}</button>
      {error ? <p className="danger" role="alert">{error}</p> : null}
    </form>
  );
}

function CloseButton(props: { onClick: () => void }) {
  const { t } = useLocale();
  return (
    <button className="dialog-close" type="button" aria-label={t.close} onClick={props.onClick}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
    </button>
  );
}

/** From a movie's page: a checkbox per list, applied at once, and a field for a new list that gets the movie. */
export function MovieListsDialog(props: { movieId: string; title: string; current: MovieListRef[]; onClose: () => void; onChange: (lists: MovieListRef[]) => void }) {
  const { t } = useLocale();
  const [lists] = useMovieLists();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inList = new Set(props.current.map((list) => list.id));
  const toggle = async (list: MovieListRef) => {
    const member = inList.has(list.id);
    const next = member ? props.current.filter((item) => item.id !== list.id) : [...props.current, { id: list.id, name: list.name }].sort(byName);
    const previous = props.current;
    setBusy(list.id);
    setError(null);
    props.onChange(next);
    try {
      await changeList(list.id, member ? { remove: [props.movieId] } : { add: [props.movieId] });
    } catch (reason) {
      props.onChange(previous);
      setError(listErrorText(reason, t));
    } finally {
      setBusy(null);
    }
  };
  return (
    <Dialog label={t.movieLists} onClose={props.onClose} className="lists-dialog">
      <CloseButton onClick={props.onClose} />
      <h2 className="dialog-title">{t.movieLists}</h2>
      <p className="muted lists-dialog-movie">{props.title}</p>
      {lists === undefined ? null : lists.length === 0 ? (
        <p className="muted">{t.noListsYet}</p>
      ) : (
        <ul className="list-checks">
          {lists.map((list) => (
            <li key={list.id}>
              <label>
                <input type="checkbox" checked={inList.has(list.id)} disabled={busy === list.id} onChange={() => void toggle(list)} />
                <span>{list.name}</span>
                <small>{countLabel(list.count, t)}</small>
              </label>
            </li>
          ))}
        </ul>
      )}
      {error ? <p className="danger" role="alert">{error}</p> : null}
      <h3>{t.newList}</h3>
      <NewListForm
        autoFocus={lists?.length === 0}
        onCreated={async (list) => {
          await changeList(list.id, { add: [props.movieId] });
          props.onChange([...props.current, list].sort(byName));
        }}
      />
    </Dialog>
  );
}

/**
 * For a selection on the Movies page: pick the list to add the movies to (or a new one), or to remove them from.
 * `onDone` gets the confirmation to show.
 */
export function ListPickerDialog(props: { mode: "add" | "remove"; movieIds: string[]; onClose: () => void; onDone: (message: string) => void }) {
  const { t } = useLocale();
  const [lists] = useMovieLists();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const title = props.mode === "add" ? t.addToList : t.removeFromList;
  const apply = async (list: MovieListRef) => {
    setBusy(true);
    setError(null);
    try {
      await changeList(list.id, props.mode === "add" ? { add: props.movieIds } : { remove: props.movieIds });
      props.onDone((props.mode === "add" ? t.addedToList : t.removedFromList).replace("{name}", list.name));
    } catch (reason) {
      setError(listErrorText(reason, t));
      setBusy(false);
    }
  };
  return (
    <Dialog label={title} onClose={props.onClose} className="lists-dialog">
      <CloseButton onClick={props.onClose} />
      <h2 className="dialog-title">{title}</h2>
      <p className="muted lists-dialog-movie">{t.selectedCount.replace("{count}", String(props.movieIds.length))}</p>
      {lists === undefined ? null : lists.length === 0 ? (
        <p className="muted">{props.mode === "add" ? t.noListsYet : t.listsEmpty}</p>
      ) : (
        <div className="list-picks" role="group" aria-label={t.pickList}>
          {lists.map((list) => (
            <button key={list.id} type="button" disabled={busy} onClick={() => void apply(list)}>
              <span>{list.name}</span>
              <small>{countLabel(list.count, t)}</small>
            </button>
          ))}
        </div>
      )}
      {error ? <p className="danger" role="alert">{error}</p> : null}
      {props.mode === "add" ? (
        <>
          <h3>{t.newList}</h3>
          <NewListForm autoFocus={lists?.length === 0} onCreated={(list) => apply(list)} />
        </>
      ) : null}
    </Dialog>
  );
}
