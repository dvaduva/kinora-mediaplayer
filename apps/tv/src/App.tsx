import { useEffect, useState } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import type { AppSetup, HomeView } from "@kinora/shared";
import { api, createSession, setConnection, setUnauthorized } from "./api";
import { AudioProvider } from "./audio";
import { Shell } from "./components/Shell";
import { loadConnection, saveConnection } from "./connection";
import { inShell, notifyShell, readShellLaunch } from "./host";
import { playerBackend } from "./player";
import { registerRemoteKeys } from "./remote";
import { LocaleProvider } from "./i18n";
import { ConnectPage } from "./pages/Connect";
import { MovieDetailPage, SeriesDetailPage } from "./pages/Detail";
import { HomePage } from "./pages/Home";
import { IdentifyPage } from "./pages/Identify";
import { LivePage, LivePlayerPage } from "./pages/Live";
import { AlbumDetailPage, ArtistDetailPage, MusicPage } from "./pages/Music";
import { MoviesPage } from "./pages/Movies";
import { ListPage, ListsPage } from "./pages/Lists";
import { PersonPage } from "./pages/Person";
import { PlayerPage } from "./pages/Player";
import { SearchPage } from "./pages/Search";
import { SeriesPage } from "./pages/Series";
import { SettingsPage } from "./pages/Settings";
import { ensureSpatial } from "./spatial";

/**
 * A paired TV (device token, `kd_…`) tells the server what it decodes on every start, so a firmware
 * update or a new player adapter changes the playback decisions without pairing again.
 */
function reportCapabilities(token: string | null | undefined) {
  if (!token || !token.startsWith("kd_")) return;
  // A bridge backend asks the shell; a shell that does not answer leaves the last report in place.
  new Promise((resolve) => resolve(playerBackend().capabilities()))
    .then((capabilities) => api("/api/devices/me/capabilities", { method: "PUT", body: JSON.stringify(capabilities) }))
    .catch(() => undefined);
}

export function App() {
  const [ready, setReady] = useState(false);
  const [connected, setConnected] = useState(false);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    ensureSpatial();
    registerRemoteKeys();
    // Inside the TV shell, pairing and the server list belong to the shell: a revoked token sends it back there.
    setUnauthorized(() => {
      if (!notifyShell("unauthorized")) setConnected(false);
    });
    void bootstrap().finally(() => setChecking(false));
  }, []);

  async function bootstrap() {
    const launch = readShellLaunch();
    // The shell hands over the device token on every launch; it lives on this origin only as long as the shell says so.
    const saved = launch.token ? { baseUrl: "", token: launch.token } : loadConnection();
    setConnection(saved);
    try {
      const setup = await api<AppSetup>("/api/setup");
      if (setup.tokenRequired) {
        if (!saved.token) {
          setConnected(false);
          setReady(true);
          return;
        }
        if (!saved.baseUrl) await createSession(saved.token);
      }
      await api<HomeView>("/api/home");
      saveConnection(saved);
      setConnected(true);
      notifyShell("ready");
      reportCapabilities(saved.token);
    } catch (reason) {
      if (reason instanceof Error && reason.message === "unauthorized") notifyShell("unauthorized");
      setConnected(false);
    } finally {
      setReady(true);
    }
  }

  if (checking || !ready) {
    return (
      <div className="boot">
        <p>Kinora TV</p>
      </div>
    );
  }

  return (
    <LocaleProvider>
      {!connected ? (
        inShell() ? (
          <div className="boot">
            <p>Kinora TV</p>
          </div>
        ) : (
          <ConnectPage onConnected={() => setConnected(true)} />
        )
      ) : (
        <BrowserRouter basename="/tv">
          <AudioProvider>
            <Routes>
              <Route path="/play/:fileId" element={<PlayerPage />} />
              <Route path="/live/:channelId" element={<LivePlayerPage />} />
              <Route element={<Shell />}>
                <Route index element={<HomePage />} />
                <Route path="movies" element={<MoviesPage />} />
                <Route path="movies/:id" element={<MovieDetailPage />} />
                <Route path="lists" element={<ListsPage />} />
                <Route path="lists/:id" element={<ListPage />} />
                <Route path="series" element={<SeriesPage />} />
                <Route path="series/:id" element={<SeriesDetailPage />} />
                <Route path="people/:id" element={<PersonPage />} />
                <Route path="music" element={<MusicPage />} />
                <Route path="music/albums/:id" element={<AlbumDetailPage />} />
                <Route path="music/artists/:id" element={<ArtistDetailPage />} />
                <Route path="live" element={<LivePage />} />
                <Route path="search" element={<SearchPage />} />
                <Route path="identify" element={<IdentifyPage />} />
                <Route path="settings" element={<SettingsPage onDisconnect={() => setConnected(false)} />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Route>
            </Routes>
          </AudioProvider>
        </BrowserRouter>
      )}
    </LocaleProvider>
  );
}
