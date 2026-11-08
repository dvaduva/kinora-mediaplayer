import assert from "node:assert/strict";
import test from "node:test";
import { clipsFrom, pairTracks, readRelease, titleKey, youtubeKey, type LocalTrack, type RemoteTrack } from "./clips.js";

test("reads YouTube keys from the link shapes MusicBrainz stores", () => {
  assert.equal(youtubeKey("https://www.youtube.com/watch?v=rYEDA3JcQqw"), "rYEDA3JcQqw");
  assert.equal(youtubeKey("https://music.youtube.com/watch?v=vBtvhPM2GHc"), "vBtvhPM2GHc");
  assert.equal(youtubeKey("https://youtu.be/hLQl3WQQoQ0"), "hLQl3WQQoQ0");
  assert.equal(youtubeKey("https://www.youtube.com/channel/UCxyz"), null);
  assert.equal(youtubeKey("https://open.spotify.com/track/4OSBTYWVwsQhGLF9NHvIbR"), null);
  assert.equal(youtubeKey("not a url"), null);
});

test("normalizes titles across diacritics, quotes and suffixes", () => {
  assert.equal(titleKey("Între cer și trecut"), titleKey("Intre cer si trecut"));
  assert.equal(titleKey("Don’t You Remember"), titleKey("Dont You Remember"));
  assert.equal(titleKey("Crazy (Radio Edit)"), titleKey("Crazy"));
});

test("reads forward music-video relations and the first YouTube link", () => {
  const tracks = readRelease({
    media: [
      {
        position: 1,
        tracks: [
          {
            position: 1,
            title: "Rolling in the Deep",
            recording: {
              relations: [
                { "target-type": "url", url: { resource: "https://open.spotify.com/track/x" } },
                { "target-type": "url", url: { resource: "https://www.youtube.com/watch?v=rYEDA3JcQqw" } },
                { "target-type": "recording", type: "music video", direction: "forward", recording: { id: "video-1" } },
                { "target-type": "recording", type: "music video", direction: "backward", recording: { id: "audio-1" } },
              ],
            },
          },
        ],
      },
    ],
  });
  assert.deepEqual(tracks, [{ disc: 1, position: 1, title: "Rolling in the Deep", videoRecordings: ["video-1"], youtube: "rYEDA3JcQqw" }]);
});

const remote: RemoteTrack[] = [
  { disc: 1, position: 1, title: "Rolling in the Deep", videoRecordings: ["v1"], youtube: "aaaaaaaaaaa" },
  { disc: 1, position: 2, title: "Rumour Has It", videoRecordings: [], youtube: "bbbbbbbbbbb" },
  { disc: 1, position: 3, title: "Turning Tables", videoRecordings: [], youtube: null },
];

test("pairs by title first, then by position only when the disc lengths agree", () => {
  const local: LocalTrack[] = [
    { id: "a", title: "rolling in the deep", trackNumber: 9, discNumber: null },
    { id: "b", title: "Track 02", trackNumber: 2, discNumber: 1 },
    { id: "c", title: "Turning Tables", trackNumber: 3, discNumber: 1 },
  ];
  const pairs = pairTracks(local, remote);
  assert.equal(pairs.get("a")?.position, 1);
  assert.equal(pairs.get("b")?.position, 2);
  assert.equal(pairs.get("c")?.position, 3);

  const shorter = pairTracks([{ id: "b", title: "Track 02", trackNumber: 2, discNumber: 1 }], remote);
  assert.equal(shorter.has("b"), false);
});

test("prefers the official video, falls back to the track's own upload", () => {
  const local: LocalTrack[] = [
    { id: "a", title: "Rolling in the Deep", trackNumber: 1, discNumber: 1 },
    { id: "b", title: "Rumour Has It", trackNumber: 2, discNumber: 1 },
    { id: "c", title: "Turning Tables", trackNumber: 3, discNumber: 1 },
  ];
  const clips = clipsFrom({ tracks: remote, videos: { v1: "vvvvvvvvvvv" } }, local);
  assert.deepEqual(clips, {
    a: { key: "vvvvvvvvvvv", kind: "video" },
    b: { key: "bbbbbbbbbbb", kind: "audio" },
  });
  const noVideoLink = clipsFrom({ tracks: remote, videos: { v1: null } }, local);
  assert.deepEqual(noVideoLink.a, { key: "aaaaaaaaaaa", kind: "audio" });
});
