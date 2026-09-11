# YouTube troubleshooting

Almost every "the bot stopped playing music" report is YouTube, not Lavamusic.
YouTube has no public audio API, so Lavalink's `youtube-source` plugin has to
impersonate YouTube's own clients — and YouTube keeps changing what it accepts.
This page is the short version of how to tell which part broke.

## The four gates

A playback request has to clear four independent checks. Each fails with a
recognisable message, and the bot now reports them in plain language in chat
rather than skipping the track silently.

| # | Gate | What it is |
|---|------|------------|
| 1 | Client identity | The `clientName` / `clientVersion` / User-Agent the plugin claims must still be accepted |
| 2 | Signature cipher | Descramble `s` and transform `n` using functions inside YouTube's `base.js` |
| 3 | Proof of humanity | poToken or OAuth — gated on your server's **IP reputation** |
| 4 | Transport | A plain stream URL, versus SABR protobuf chunks (which have no URL) |

Your `clients:` list in `Lavalink/application.yml` is a queue of disguises,
tried in order until one answers.

## Start here

The bot tells you which gate closed. If a track fails you'll see something like:

> Couldn't play **Despacito** — skipping.
> YouTube changed its player script and the node can't decode stream URLs.

| What the bot says | Gate | Fix |
|---|---|---|
| "rate-limiting this node" | 3 | Wait. Usually clears within hours. Not a config problem |
| "changed its player script" | 2 | Configure `remoteCipher`, then bump the plugin pin |
| "didn't return a playable audio stream" | 4 | SABR-only. Drop that client; config can't fix it |
| "rejected every client identity" | 1 | Bump the plugin pin |
| "age-restricted, private, or blocked" | — | Not a bug; that video really is unavailable |

For a full per-client picture, run `ytdiag` (owner-only). It probes every client
through the real playback path and names the gate each one fails at.

## The three settings that matter

### 1. Pin the plugin to a commit, not a release

Fixes land on `youtube-source`'s `main` branch weeks before a release is tagged,
so a release number — or `latest.release` — will usually be broken.

```yaml
lavalink:
  plugins:
    - dependency: "dev.lavalink.youtube:youtube-plugin:<40-char commit hash>"
      repository: "https://maven.lavalink.dev/snapshots"
      snapshot: true
```

The version is the **bare hash**. `<hash>-SNAPSHOT` does not resolve.
`Lavalink/diagnostics/README.md` has a one-liner for finding the current one.

### 2. Configure a remote cipher

Signature deciphering is no longer maintained in-plugin, so this is effectively
required. Without it you get
`ScriptExtractionException: Must find sig function`.

```yaml
plugins:
  youtube:
    remoteCipher:
      url: "https://cipher.kikkia.dev"
      userAgent: "lavamusic"
```

The public instance needs no password and allows 10 req/s. If you self-host it
in Docker, use the service name — `localhost` inside the Lavalink container is
the container itself.

### 3. Nest `clientOptions` correctly

::: warning
Per-client capability toggles **must** be nested under `clientOptions:`. Bare
top-level client keys match no property and are **silently ignored** — this
tripped up this repo's own example config for a long time.
:::

```yaml
# WRONG - silently does nothing
plugins:
  youtube:
    IOS:
      searching: false

# RIGHT
plugins:
  youtube:
    clientOptions:
      IOS:
        searching: false
```

Whichever client comes **first** and claims `searching` handles search. `IOS`
streams reliably but returns nothing for search, so if it leads the list it must
have `searching: false`, or every search comes back empty.

Watch playlists too: `TV` has no metadata support at all and `TVHTML5_SIMPLY`
has no playlist support, so leave `playlistLoading` enabled on a client that
actually supports it.

## Choosing a client order

::: tip
Client results are **IP-dependent**. Gate 3 is IP reputation, so an order that
works on one network can fail on another. Datacenter and corporate ranges get
flagged far faster than residential ones. Measure from where your bot actually
runs.
:::

Run the diagnostics rig (`Lavalink/diagnostics/`) or `ytdiag`, put the clients
that stream cleanly first, then two rules:

1. **Prefer a client with Opus formats.** `IOS` is reliable but returns AAC,
   which forces a transcode on every track. `TVHTML5_SIMPLY`, `ANDROID_VR`,
   `WEB` and `MWEB` offer Opus, which passes through untouched — noticeably less
   CPU. If one of those passes on your network, put it first.
2. **Search needs a search-capable client**, and playlists need a
   playlist-capable one. See above.

Verify all four paths after reordering — playback, search, direct URL, playlist.
Fixing one commonly breaks another.

## When nothing works

Work down this list; each step costs more than the last.

1. **Newer plugin commit.** Cheapest, fixes most breakage.
2. **poToken** — needs a service that can run YouTube's JS challenge. Applies
   only to `WEB`/`WEBEMBEDDED`.
3. **OAuth** — a real Google account. Use a **burner, never your main one**:
   worst case is account termination. Only worth it if diagnostics show genuine
   bot-check errors *from your IP*.
4. **yt-dlp** via LavaSrc's `ytdlp` source. It shells out to the `yt-dlp` binary
   purely as a URL extractor — it does **not** download the file; Lavaplayer
   still streams over HTTP. Costs ~0.5–3 s of process start per track, but
   yt-dlp tracks YouTube changes nightly. Two catches: it needs the `yt-dlp`
   binary inside the Lavalink container, and it registers as source name
   `"youtube"` claiming `ytsearch:` exactly like `youtube-source` — so enabling
   both is a **collision, not a fallback**. Pick one.

Note that yt-dlp does **not** solve gate 4: its SABR support cannot stream to
stdout, and LavaSrc's integration needs a URL, so it hits the same wall.

## Don't

- Don't use `latest.release` for the plugin — it can't reach fixes that only
  exist on `main`, which is where fixes live.
- Don't test only with `dQw4w9WgXcQ`; it bypasses some checks and reports
  healthy while other videos fail.
- Don't enable both `youtube-source` and LavaSrc's `ytdlp` source.
- Don't commit `Lavalink/application.yml` — it holds credentials and is
  gitignored. Edit it in place; `example.application.yml` is the template.
- Don't reach for OAuth before running diagnostics.
