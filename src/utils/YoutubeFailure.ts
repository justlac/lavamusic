/**
 * Classification of YouTube playback failures.
 *
 * A YouTube playback request has to clear four gates, and each one fails with a
 * recognisable message. Mapping the message back to its gate is what lets the
 * bot say "the node's cipher is stale" instead of pasting a Java exception.
 *
 *   1. client identity  - the impersonated clientName/clientVersion/User-Agent
 *   2. signature cipher - descramble `s`, transform `n`, from YouTube's base.js
 *   3. proof of humanity - poToken / OAuth, gated on IP reputation
 *   4. transport         - a plain stream URL, vs SABR protobuf chunks
 */
export type FailureKind = "botcheck" | "cipher" | "noformats" | "client" | "restricted" | "unknown";

/**
 * Matched against the Lavalink exception message in order, most specific first.
 * The patterns come from failures observed against a live node, not guesses.
 */
const FAILURE_PATTERNS: Array<{ kind: FailureKind; pattern: RegExp }> = [
	// Gate 3 - IP reputation. Transient, and not the user's fault.
	{ kind: "botcheck", pattern: /sign in to confirm|not a bot/i },
	// Gate 2 - the plugin could not read YouTube's signature functions.
	{ kind: "cipher", pattern: /must find sig|scriptextraction|cipher|signature/i },
	// Gate 4 - the response carried no plain-URL format (SABR-only), or none of
	// the formats it did carry were usable.
	{
		kind: "noformats",
		pattern:
			/could not find formats|no formats found|no suitable formats|no playable|missing format url|sabr/i,
	},
	// Gate 1 - every impersonated client identity was rejected. "cannot be
	// loaded" is CannotBeLoaded, i.e. playabilityStatus was not OK for THIS
	// client - observed live on TVHTML5_SIMPLY/ANDROID_VR for a video that IOS
	// played fine, so it is the identity being refused, not the video.
	{
		kind: "client",
		pattern:
			/page needs to be reloaded|failed_precondition|all ?clients ?failed|http 400|cannot be loaded/i,
	},
	// Not a gate - the video itself is unavailable to an anonymous viewer.
	{
		kind: "restricted",
		pattern: /requires login|age.?restrict|private|unavailable|copyright|blocked/i,
	},
];

/**
 * Maps a Lavalink exception message to the gate it corresponds to.
 * Returns "unknown" for anything unrecognised - never throws.
 */
export function classifyFailure(message?: string | null): FailureKind {
	if (!message) return "unknown";
	for (const { kind, pattern } of FAILURE_PATTERNS) {
		if (pattern.test(message)) return kind;
	}
	return "unknown";
}

/** Short label for the gate a failure belongs to, for diagnostics output. */
export const FAILURE_GATE: Record<FailureKind, string> = {
	client: "gate 1 - client identity",
	cipher: "gate 2 - signature cipher",
	botcheck: "gate 3 - proof of humanity",
	noformats: "gate 4 - transport (SABR)",
	restricted: "video unavailable",
	unknown: "unclassified",
};
