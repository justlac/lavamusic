import type { LavalinkNodeOptions } from "lavalink-client";
import { classifyFailure, FAILURE_GATE } from "./YoutubeFailure";

/**
 * Client identifiers youtube-source can register. The plugin exposes no route
 * listing which ones are actually configured (GET /youtube returns only the
 * OAuth refresh token, which is a secret we deliberately never read), so we
 * probe the full set and report unconfigured ones separately.
 */
export const CLIENT_IDENTIFIERS = [
	"IOS",
	"TVHTML5",
	"TVHTML5_SIMPLY",
	"ANDROID_VR",
	"ANDROID_MUSIC",
	"WEB",
	"WEB_REMIX",
	"WEB_EMBEDDED_PLAYER",
	"MWEB",
] as const;

/**
 * Deliberately NOT the Rick Astley video: it bypasses some of YouTube's checks
 * and reports healthy when other videos fail.
 */
export const PROBE_VIDEO_ID = "kJQP7kiw5Fk";

/** Per-client budget. Nine clients worst case, so keep it tight. */
const PROBE_TIMEOUT_MS = 6000;

export type ProbeOutcome = {
	client: string;
	status: "ok" | "fail" | "unconfigured";
	detail: string;
};

/**
 * Runs the full playback path for one client via youtube-source's own REST
 * route - InnerTube /player, cipher, then a real HTTP stream - and stops as
 * soon as the first bytes arrive. This is the same check the offline probe
 * script performs, so the verdicts are directly comparable.
 */
export async function probeClient(
	options: Pick<LavalinkNodeOptions, "host" | "port" | "authorization" | "secure">,
	client: string,
): Promise<ProbeOutcome> {
	const scheme = options.secure ? "https" : "http";
	const base = `${scheme}://${options.host}:${options.port}`;
	const url = `${base}/youtube/stream/${PROBE_VIDEO_ID}?withClient=${client}`;

	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);

	try {
		const response = await fetch(url, {
			headers: { Authorization: options.authorization },
			signal: controller.signal,
		});

		if (!response.ok) {
			const body = await response.text().catch(() => "");
			const message = /"message":"([^"]+)"/.exec(body)?.[1] ?? `HTTP ${response.status}`;
			// NOTE: this only catches the global "no client supports format
			// loading" case. A single client missing from the node's config is
			// indistinguishable from a broken one - verified live: ANDROID_MUSIC
			// and WEB_EMBEDDED_PLAYER were absent from the config yet reported
			// "Could not find formats", same as a genuinely failing client.
			if (/none of the registered clients|not registered/i.test(message)) {
				return { client, status: "unconfigured", detail: "not in the client list" };
			}
			const kind = classifyFailure(message);
			return { client, status: "fail", detail: `${FAILURE_GATE[kind]} - ${message}` };
		}

		// Pull one chunk to prove audio actually flows, then stop the download.
		const reader = response.body?.getReader();
		const chunk = await reader?.read();
		const bytes = chunk?.value?.byteLength ?? 0;
		controller.abort();

		return bytes > 0
			? { client, status: "ok", detail: `streaming (${bytes} B in first chunk)` }
			: { client, status: "fail", detail: "connected but sent no audio" };
	} catch (error) {
		const aborted = error instanceof Error && error.name === "AbortError";
		return {
			client,
			status: "fail",
			detail: aborted ? `no response within ${PROBE_TIMEOUT_MS} ms` : String(error),
		};
	} finally {
		clearTimeout(timer);
	}
}
