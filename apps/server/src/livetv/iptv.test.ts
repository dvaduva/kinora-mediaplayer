import assert from "node:assert/strict";
import test from "node:test";
import { assignNumbers, cleanName, entryKeys, isStreamUrl, parseM3u } from "./m3u.js";
import { relayArgs, relayCodecs, relayErrorText } from "./relay.js";
import { episodeLabel, matchGuideChannels, normalizeChannelName, parseXmltv, parseXmltvTime, tidyProgrammes, XmltvReader, type XmltvProgramme } from "./xmltv.js";

const PLAYLIST = `#EXTM3U url-tvg="https://epg.example/guide.xml.gz,https://other.example/g.xml"
#EXTINF:-1 tvg-id="pro.ro" tvg-name="PRO TV" tvg-logo="https://logo.example/pro.png" tvg-chno="2" group-title="Generale",PRO TV HD
#EXTVLCOPT:http-user-agent=Something
http://stream.example/pro/index.m3u8
#EXTINF:-1 tvg-id="" group-title="Știri, Info",Digi 24
#EXTGRP:Ignored because group-title is set
https://stream.example/digi24.m3u8
#EXTINF:0,Radio
#EXTGRP:Radio
rtmp://radio.example/live
#EXTINF:-1,Local file
file:///etc/passwd
#EXTINF:-1 tvg-chno="abc",Bad number
udp://@239.0.0.1:1234
http://orphan.example/without-extinf
`;

test("M3U: attributes, names, groups and unsafe addresses", () => {
  const playlist = parseM3u(PLAYLIST);
  assert.equal(playlist.epgUrl, "https://epg.example/guide.xml.gz");
  assert.deepEqual(
    playlist.entries.map((entry) => [entry.name, entry.tvgId, entry.number, entry.group, entry.tvgLogo]),
    [
      ["PRO TV HD", "pro.ro", 2, "Generale", "https://logo.example/pro.png"],
      ["Digi 24", null, null, "Știri, Info", null],
      ["Radio", null, null, "Radio", null],
      ["Bad number", null, null, null, null],
    ],
  );
  assert.equal(playlist.entries[0]!.tvgName, "PRO TV");
  assert.equal(playlist.entries[0]!.url, "http://stream.example/pro/index.m3u8");
  assert.equal(isStreamUrl("file:///etc/passwd"), false);
  assert.equal(isStreamUrl("concat:a|b"), false);
});

test("M3U: names lose the notes iptv-org appends", () => {
  assert.equal(cleanName("A7TV (1080p)"), "A7TV");
  assert.equal(cleanName("Agro TV (Romania) (360p) [Not 24/7]"), "Agro TV (Romania)");
  assert.equal(cleanName("[Geo-blocked]"), "[Geo-blocked]");
  const playlist = ["#EXTM3U", '#EXTINF:-1 tvg-id="Acasa.ro@SD",Acasa (1080p) [Geo-blocked]', "http://x.example/a.m3u8"].join("\n");
  assert.equal(parseM3u(playlist).entries[0]!.name, "Acasa");
});

test("M3U: keys stay stable across refreshes and tell duplicates apart", () => {
  const keys = entryKeys([
    { tvgId: "a", name: "One" },
    { tvgId: null, name: "Two" },
    { tvgId: "a", name: "One" },
  ]);
  assert.deepEqual(keys, ["a|one", "|two", "a|one#2"]);
});

test("M3U: playlist numbers are used when free, the rest follow the highest number", () => {
  assert.deepEqual(assignNumbers([{ number: 2 }, { number: 5 }, { number: null }, { number: 2 }], new Set([1, 5])), [2, 6, 7, 8]);
  assert.deepEqual(assignNumbers([{ number: null }], new Set([9999])), [null]);
});

const GUIDE = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE tv SYSTEM "xmltv.dtd">
<tv generator-info-name="test">
  <channel id="Pro.ro"><display-name lang="ro">PRO TV</display-name><icon src="x.png"/></channel>
  <channel id="digi24.ro"><display-name>Digi 24 HD</display-name></channel>
  <channel id="film.ro"><display-name>Film Now</display-name></channel>
  <programme start="20261108200000 +0200" stop="20261108210000 +0200" channel="Pro.ro">
    <title lang="ro">Știrile &amp; vremea</title>
    <sub-title><![CDATA[Ediția <de> seară]]></sub-title>
    <desc>Prezentator: A &#x26; B</desc>
    <episode-num system="xmltv_ns">0.3.</episode-num>
  </programme>
  <programme start="20261108210000 +0200" channel="Pro.ro"><title>Film</title></programme>
  <programme start="20261108220000 +0200" stop="20261108230000 +0200" channel="Pro.ro"><title>Late</title><episode-num system="onscreen">S02E05</episode-num></programme>
  <programme start="20261108190000" stop="20261108193000" channel="digi24.ro"><title>Știri</title></programme>
  <programme start="bad" channel="digi24.ro"><title>Broken</title></programme>
</tv>`;

test("XMLTV: channels, programmes, entities and zones", () => {
  const { channels, programmes } = parseXmltv(GUIDE);
  assert.deepEqual(channels, [
    { id: "Pro.ro", names: ["PRO TV"] },
    { id: "digi24.ro", names: ["Digi 24 HD"] },
    { id: "film.ro", names: ["Film Now"] },
  ]);
  assert.equal(programmes.length, 4);
  const first = programmes[0]!;
  assert.equal(first.title, "Știrile & vremea");
  assert.equal(first.subtitle, "S1 · E4 · Ediția <de> seară");
  assert.equal(first.description, "Prezentator: A & B");
  assert.equal(first.start, Date.UTC(2026, 10, 8, 18, 0, 0));
  assert.equal(first.end, Date.UTC(2026, 10, 8, 19, 0, 0));
  assert.ok(Number.isNaN(programmes[1]!.end));
  assert.equal(programmes[2]!.subtitle, "S2 · E5");
  // No zone means UTC.
  assert.equal(programmes[3]!.start, Date.UTC(2026, 10, 8, 19, 0, 0));
});

test("XMLTV: the reader copes with any split of the text", () => {
  const whole = parseXmltv(GUIDE);
  for (const size of [1, 7, 64, 333]) {
    const programmes: XmltvProgramme[] = [];
    let channels = 0;
    const reader = new XmltvReader({ channel: () => (channels += 1), programme: (programme) => programmes.push(programme) });
    for (let index = 0; index < GUIDE.length; index += size) reader.push(GUIDE.slice(index, index + size));
    reader.end();
    assert.equal(channels, 3, `split ${size}`);
    assert.deepEqual(programmes.map((entry) => entry.title), whole.programmes.map((entry) => entry.title), `split ${size}`);
  }
});

test("XMLTV: times, numbering and tidying", () => {
  assert.equal(parseXmltvTime("202611082030 -0130"), Date.UTC(2026, 10, 8, 22, 0, 0));
  assert.equal(parseXmltvTime("20261108"), Date.UTC(2026, 10, 8));
  assert.equal(parseXmltvTime("soon"), null);
  assert.equal(episodeLabel('<episode-num system="xmltv_ns">.9/10.</episode-num>'), "E10");
  assert.equal(episodeLabel('<episode-num system="onscreen">Ep. 4</episode-num>'), null);
  const at = (hour: number) => Date.UTC(2026, 0, 1, hour);
  const base = { channel: "c", subtitle: null, description: null };
  const tidy = tidyProgrammes([
    { ...base, title: "B", start: at(2), end: Number.NaN },
    { ...base, title: "A", start: at(1), end: at(2) },
    { ...base, title: "A again", start: at(1), end: at(2) },
    { ...base, title: "C", start: at(3), end: at(4) },
    { ...base, title: "Open end", start: at(4), end: Number.NaN },
  ]);
  assert.deepEqual(
    tidy.map((entry) => [entry.title, entry.start, entry.end]),
    [
      ["A", at(1), at(2)],
      ["B", at(2), at(3)],
      ["C", at(3), at(4)],
    ],
  );
});

test("EPG matching: manual, then tvg-id, then name", () => {
  assert.equal(normalizeChannelName("RO: Digi 24 HD"), "digi24");
  assert.equal(normalizeChannelName("Antena 1 (FHD) [backup]"), "antena1");
  assert.equal(normalizeChannelName("Știri TV"), "stiritv");
  const { channels: guide } = parseXmltv(GUIDE);
  const matches = matchGuideChannels(
    [
      { id: "1", name: "PRO TV HD", tvgId: "pro.ro", tvgName: null, epgChannel: null },
      { id: "2", name: "RO | Digi 24", tvgId: null, tvgName: null, epgChannel: null },
      { id: "3", name: "Something", tvgId: null, tvgName: "Film Now", epgChannel: null },
      { id: "4", name: "PRO TV", tvgId: "pro.ro", tvgName: null, epgChannel: "film.ro" },
      { id: "5", name: "Unknown", tvgId: "nope", tvgName: null, epgChannel: null },
    ],
    guide,
  );
  assert.deepEqual(matches.get("1"), { epgId: "Pro.ro", how: "tvg-id" });
  assert.deepEqual(matches.get("2"), { epgId: "digi24.ro", how: "name" });
  assert.deepEqual(matches.get("3"), { epgId: "film.ro", how: "name" });
  assert.deepEqual(matches.get("4"), { epgId: "film.ro", how: "manual" });
  assert.equal(matches.has("5"), false);
  // iptv-org playlists name feeds "<id>@SD"; guides list the bare id.
  const feed = matchGuideChannels([{ id: "6", name: "X", tvgId: "PRO.ro@HD", tvgName: null, epgChannel: null }], guide);
  assert.deepEqual(feed.get("6"), { epgId: "Pro.ro", how: "tvg-id" });
});

test("relay: copies H.264/AAC, converts the rest, and keeps a rolling window", () => {
  assert.deepEqual(relayCodecs([{ codec_type: "video", codec_name: "h264" }, { codec_type: "audio", codec_name: "aac" }]), { hasVideo: true, copyVideo: true, copyAudio: true });
  assert.deepEqual(relayCodecs([{ codec_type: "video", codec_name: "hevc" }, { codec_type: "audio", codec_name: "ac3" }]), { hasVideo: true, copyVideo: false, copyAudio: false });
  assert.deepEqual(relayCodecs([{ codec_type: "audio", codec_name: "mp3" }, { codec_type: "video", codec_name: "mjpeg" }]), { hasVideo: false, copyVideo: false, copyAudio: true });

  const copy = relayArgs("http://s.example/live.m3u8", "D:/cache/iptv/c1", { hasVideo: true, copyVideo: true, copyAudio: true });
  assert.ok(copy.includes("-protocol_whitelist"));
  assert.equal(copy[copy.indexOf("-reconnect") + 1], "1");
  assert.equal(copy[copy.indexOf("-c:v") + 1], "copy");
  assert.equal(copy[copy.indexOf("-hls_flags") + 1], "delete_segments+independent_segments+temp_file");
  assert.ok(!copy.includes("-start_number"));
  assert.ok(!copy.includes("-hls_playlist_type"));

  const restarted = relayArgs("rtsp://cam.example/1", "D:/cache/iptv/c1", { hasVideo: true, copyVideo: false, copyAudio: false }, 42, "libx264");
  assert.ok(!restarted.includes("-reconnect"), "reconnect options are http only");
  assert.equal(restarted[restarted.indexOf("-c:v") + 1], "libx264");
  assert.equal(restarted[restarted.indexOf("-c:a") + 1], "aac");
  assert.equal(restarted[restarted.indexOf("-start_number") + 1], "42");
  assert.match(restarted[restarted.indexOf("-hls_flags") + 1]!, /discont_start/);

  const url = "http://user:secret@s.example/live/u/p/1.m3u8";
  assert.equal(relayErrorText(`${url}: Server returned 404 Not Found`, url), "stream: Server returned 404 Not Found");
  assert.equal(relayErrorText("Opening 'https://cdn.example/x.ts?token=1' failed", url), "Opening 'stream failed");

  const radio = relayArgs("http://r.example/stream", "D:/x", { hasVideo: false, copyVideo: false, copyAudio: true });
  assert.ok(!radio.includes("0:v:0"));
  assert.ok(!radio.includes("-c:v"));
});
