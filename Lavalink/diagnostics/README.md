# YouTube diagnostics

A throwaway Lavalink node for working out *why* YouTube playback broke, without
touching the bot.

It runs **only** `youtube-source` — no Discord token, no bot, no credentials, no
LavaSrc — so any failure here is unambiguously YouTube rather than something in
Lavamusic. Nothing in this directory contains a secret.

## Run it

```bash
cd Lavalink/diagnostics
docker compose -f compose.rig.yaml up -d
sleep 30

# confirm the plugin loaded and note the registered client identifiers
docker logs lava-rig-lavalink 2>&1 | grep -E 'initialised with clients|remote cipher'

bash probe.sh    # per-client verdicts across several videos
bash chain.sh    # natural fallback chain + search / URL / playlist

docker compose -f compose.rig.yaml down -v
```

`probe.sh` uses `youtube-source`'s own REST route,
`GET /youtube/stream/{videoId}?withClient=X`, which runs the **full** playback
path — InnerTube `/player` → cipher → a real HTTP stream — and returns actual
audio bytes. That's why it can tell "works" from "returns metadata but won't
play", which `/v4/loadtracks` alone cannot.

The same diagnosis is available from Discord via `/ytdiag` (dev-only) once the
bot is running; this rig is for when the bot itself won't start, or when you
want to iterate on `application.yml` without restarting the bot.

## Reading the output

| Message | Gate | What to do |
|---|---|---|
| `Must find sig function from script: …base.js` | 2 — cipher | Configure `remoteCipher` (see `application.rig.yml`) |
| plays but ~16–30 KB/s | 2 — cipher | Same; the `n` transform is wrong and fails *soft* |
| `Could not find formats for the requested videoId.` | 4 — transport | SABR-only response. Config can't fix it; drop that client |
| `No formats found with the requested itag.` | 4 — transport | Formats returned but none usable |
| `This video cannot be loaded` | 1/3 | That client identity was refused for this video |
| `Sign in to confirm you're not a bot.` | 3 — humanity | IP reputation. Usually clears in hours |
| `The page needs to be reloaded.` / `HTTP 400` | 1 — identity | Bump the plugin pin (below) |
| `AllClientsFailedException` | — | **Not a cause.** Read the per-client errors underneath |

### Expected noise from this config

`probe.sh` ends with a search check that will report `"loadType":"empty"` here.
That is **correct and not a failure**: `application.rig.yml` enables every
capability on every client so each one can be probed individually, which puts
`IOS` first claiming `searching` — and `IOS` returns nothing for search. In a
production config `IOS` gets `searching: false`. Use `chain.sh` to test search
against a realistic client order.

### Two things that will mislead you

- **Never test only with `dQw4w9WgXcQ`.** It bypasses some checks and reports
  healthy while real videos fail — observed directly: `ANDROID_VR` passed on it
  and failed all three other test videos. Both scripts keep it last, as a
  control only.
- **Results are IP-dependent.** Gate 3 is IP reputation, so a verdict from one
  network says little about another. Re-run this from wherever the bot actually
  runs before trusting the client order.

## Keeping the plugin pin current

Releases lag YouTube breakage by weeks — fixes land on `youtube-source`'s `main`
branch first, published as per-commit snapshots. `latest.release` is therefore
useless here: it can only ever reach the newest *tag*.

Find the newest `main` commit that actually has a published jar:

```bash
curl -s "https://maven.lavalink.dev/api/maven/details/snapshots/dev/lavalink/youtube/youtube-plugin" \
  | grep -oE '"name":"[0-9a-f]{40}"' | grep -oE '[0-9a-f]{40}' | sort > /tmp/snap.txt

curl -s "https://api.github.com/repos/lavalink-devs/youtube-source/commits?sha=main&per_page=100" \
  | grep -oE '"sha": "[0-9a-f]{40}"' | grep -oE '[0-9a-f]{40}' > /tmp/main.txt

grep -nxFf /tmp/snap.txt /tmp/main.txt | head -1
```

The first line is your pin. The version is the **bare hash** — `<hash>-SNAPSHOT`
does not resolve. Update it in both `application.rig.yml` and
`../example.application.yml`, and skim the recent commit subjects: they name the
breakage in plain language.

## Gotchas that cost real time

- Per-client capability toggles **must** be nested under `clientOptions:`.
  `YoutubeConfig` binds a `Map<String, ClientOptions>` at
  `plugins.youtube.clientOptions`, so bare top-level client keys match no
  property and are silently discarded. Every Lavalink config that copies the
  bare form has dead toggles.
- Client **identifiers** differ from config **names**: `WEBEMBEDDED` →
  `WEB_EMBEDDED_PLAYER`, `MUSIC` → `WEB_REMIX`, `TV` → `TVHTML5`. `withClient`
  wants the identifier, which the boot log prints.
- Inside Docker, `remoteCipher.url: http://localhost:8001` is the *Lavalink
  container itself*. Use a service name, or the public instance.
- Whichever client comes first and claims `searching` handles search. `IOS`
  streams well but returns nothing for search, so it must have
  `searching: false` or every search returns `loadType: empty`.
- Behind a TLS-inspecting proxy the JVM needs the proxy's root CA in its
  truststore, or the plugin download fails with `PKIX path building failed`
  before the node even starts.
