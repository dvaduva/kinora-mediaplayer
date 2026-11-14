import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { MOVIE_LIST_NAME_MAX, type MovieListDetail } from "@kinora/shared";
import { api } from "@kinora/client";
import { useCached } from "../cache";
import { useLocale } from "../i18n";
import { changeList, countLabel, ListCover, listErrorText, MovieTabs, NewListForm, refreshLists, useMovieLists } from "../lists";
import { Dialog } from "../movieExtras";
import { SkeletonGrid } from "../ui";
import { MovieBrowser } from "./Browse";

/** Every list as a card with a poster collage, plus the field for a new one. */
export function ListsPage() {
  const { t } = useLocale();
  const navigate = useNavigate();
  const [lists] = useMovieLists();
  const [creating, setCreating] = useState(false);
  return (
    <>
      <h1>{t.lists}</h1>
      <MovieTabs />
      <div className="list-toolbar">
        <p className="muted lists-help">{t.listsHelp}</p>
        {creating ? null : (
          <button className="play" type="button" onClick={() => setCreating(true)}>{t.newList}</button>
        )}
      </div>
      {creating ? <NewListForm autoFocus onCreated={(list) => navigate(`/lists/${list.id}`)} /> : null}
      {lists === undefined ? (
        <SkeletonGrid count={6} square />
      ) : lists.length === 0 ? (
        <section className="plain">
          <h2>{t.listsEmpty}</h2>
          <p className="lede">{t.listsEmptyHelp}</p>
        </section>
      ) : (
        <div className="grid list-grid">
          {lists.map((list) => (
            <Link key={list.id} className="poster-card list-card" to={`/lists/${list.id}`}>
              <ListCover name={list.name} posters={list.posters} />
              <span>{list.name}</span>
              <small>{countLabel(list.count, t)}</small>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}

/** One list: the Movies page's filters and sorting over its movies, renaming, deleting, and removing a selection. */
export function ListPage() {
  const { id = "" } = useParams();
  const { t } = useLocale();
  const navigate = useNavigate();
  const [list] = useCached<MovieListDetail | null>(`/api/lists/${id}`, null);
  const [renaming, setRenaming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 4000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  if (list === null) {
    return (
      <>
        <h1>{t.lists}</h1>
        <MovieTabs />
        <p className="muted">{t.listEmpty}</p>
      </>
    );
  }
  return (
    <>
      <p className="list-back">
        <Link className="text-button small" to="/lists">← {t.lists}</Link>
      </p>
      {renaming && list ? (
        <RenameForm id={list.id} name={list.name} onClose={() => setRenaming(false)} />
      ) : (
        <h1>{list?.name ?? "…"}</h1>
      )}
      <div className="list-actions">
        {list ? <span className="muted">{countLabel(list.movies.length, t)}</span> : null}
        <span className="spacer" />
        <button className="pill-button" type="button" disabled={!list || renaming} onClick={() => setRenaming(true)}>{t.renameList}</button>
        <button className="pill-button danger" type="button" disabled={!list} onClick={() => setDeleting(true)}>{t.deleteList}</button>
      </div>
      {notice ? <p className="list-notice" role="status">{notice}</p> : null}
      <MovieBrowser
        movies={list?.movies}
        emptyText={`${t.listEmpty} ${t.listsEmptyHelp}`}
        selectionActions={(ids, done) => (
          <button
            className="play"
            type="button"
            disabled={ids.length === 0 || !list}
            onClick={() => {
              if (!list) return;
              changeList(list.id, { remove: ids })
                .then(() => {
                  setNotice(t.removedFromList.replace("{name}", list.name));
                  done();
                })
                .catch((reason) => setNotice(listErrorText(reason, t)));
            }}
          >
            {t.removeFromList}
          </button>
        )}
      />
      {deleting && list ? (
        <Dialog label={t.deleteList} onClose={() => setDeleting(false)} className="leave-dialog">
          <h2 className="dialog-title">{t.deleteListTitle.replace("{name}", list.name)}</h2>
          <p>{t.deleteListText}</p>
          <div className="dialog-actions">
            <button className="play" type="button" data-autofocus onClick={() => setDeleting(false)}>{t.cancel}</button>
            <button
              className="text-button danger"
              type="button"
              onClick={() => {
                api(`/api/lists/${list.id}`, { method: "DELETE" })
                  .then(() => {
                    refreshLists();
                    navigate("/lists", { replace: true });
                  })
                  .catch((reason) => {
                    setDeleting(false);
                    setNotice(listErrorText(reason, t));
                  });
              }}
            >
              {t.deleteConfirm}
            </button>
          </div>
        </Dialog>
      ) : null}
    </>
  );
}

function RenameForm(props: { id: string; name: string; onClose: () => void }) {
  const { t } = useLocale();
  const [name, setName] = useState(props.name);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (name.trim() === props.name) return props.onClose();
    setSaving(true);
    setError(null);
    try {
      await api(`/api/lists/${props.id}`, { method: "PUT", body: JSON.stringify({ name }) });
      refreshLists();
      props.onClose();
    } catch (reason) {
      setError(listErrorText(reason, t));
      setSaving(false);
    }
  };
  return (
    <form className="new-list rename-list" onSubmit={(event) => void submit(event)}>
      <input
        value={name}
        maxLength={MOVIE_LIST_NAME_MAX}
        onChange={(event) => setName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") props.onClose();
        }}
        aria-label={t.listName}
        autoFocus
      />
      <button className="play" type="submit" disabled={!name.trim() || saving}>{t.save}</button>
      <button className="text-button" type="button" onClick={props.onClose}>{t.cancel}</button>
      {error ? <p className="danger" role="alert">{error}</p> : null}
    </form>
  );
}
