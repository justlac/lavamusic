/** biome-ignore-all lint/style/noNonNullAssertion: <> */
import type {
	Player,
	SearchPlatform,
	Track,
	TrackRequester,
	UnresolvedTrack,
} from "lavalink-client";
import { env } from "../../env";
import { I18N, t } from "../../structures/I18n";
import logger from "../../structures/Logger";
import type { Requester } from "../../types";
import { getArtistTopTracks, getSimilarTracks, type TrackLike } from "../LastFm";

/**
 * Transforms a requester into a standardized requester object.
 *
 * @param {any} requester The requester to transform. Can be a string, a user, or an object with
 *                        the keys `id`, `username`, and `avatarURL`.
 * @returns {Requester} The transformed requester object.
 */
export const requesterTransformer = (requester: any): Requester => {
	// if it's already the transformed requester
	if (typeof requester === "object" && "avatar" in requester && Object.keys(requester).length === 3)
		return requester as Requester;
	// if it's still a string
	if (typeof requester === "object" && "displayAvatarURL" in requester) {
		// it's a user
		return {
			id: requester.id,
			username: requester.username,
			avatarURL: requester.displayAvatarURL({ extension: "png" }),
			discriminator: requester.discriminator,
		};
	}
	return { id: requester?.toString() || "unknown", username: "unknown" };
};

/**
 * Generates a fingerprint for a track to detect duplicates
 */
function getTrackFingerprint(track: TrackLike): string {
	// `author` is optional on UnresolvedTrack - reading it unguarded threw.
	const title = (track.info.title ?? "").toLowerCase().trim();
	const author = (track.info.author ?? "").toLowerCase().trim();
	// Normalize by removing special characters and extra spaces
	const normalizedTitle = title.replace(/[^\w\s]/g, "").replace(/\s+/g, " ");
	const normalizedAuthor = author.replace(/[^\w\s]/g, "").replace(/\s+/g, " ");
	return `${normalizedAuthor}::${normalizedTitle}`;
}

/**
 * Checks if a track has been played or is in the queue
 */
function isTrackDuplicate(player: Player, track: TrackLike, autoplayHistory: Set<string>): boolean {
	const fingerprint = getTrackFingerprint(track);

	// Check autoplay history (last 50 tracks)
	if (autoplayHistory.has(fingerprint)) {
		return true;
	}

	// Check currently playing
	if (player.queue.current) {
		const currentFingerprint = getTrackFingerprint(player.queue.current);
		if (currentFingerprint === fingerprint) {
			return true;
		}
	}

	// Check current queue
	for (const queuedTrack of player.queue.tracks) {
		const queuedFingerprint = getTrackFingerprint(queuedTrack);
		if (queuedFingerprint === fingerprint) {
			return true;
		}
	}

	// Check previous queue (last 10 tracks)
	const recentHistory = player.queue.previous.slice(-10);
	for (const historyTrack of recentHistory) {
		const historyFingerprint = getTrackFingerprint(historyTrack);
		if (historyFingerprint === fingerprint) {
			return true;
		}
	}

	return false;
}

/** Metadata autoplay stamps onto the tracks it queues, read back by the UI. */
type AutoplayClientData = { fromAutoplay?: boolean; autoplaySeed?: string };

/**
 * Autoplay searches the same "Artist - Title" strings over and over across a
 * session, and every one of those is a YouTube request that counts against the
 * node's bot-check reputation. Caching them removes the repeats entirely.
 *
 * Only fully resolved tracks are cached: an UnresolvedTrack carries a
 * `resolve()` function, which would not survive being cloned.
 *
 * Encoded tracks are stable - the time-limited stream URL is resolved at play
 * time, not stored here - so entries do not go stale.
 */
const SEARCH_CACHE_LIMIT = 300;
const searchCache = new Map<string, Track>();

/**
 * Resolves one autoplay candidate to a playable track, serving repeats from the
 * in-process cache. The returned track is always a fresh copy, so the caller
 * can safely attach its own requester and mutate `pluginInfo.clientData`.
 */
async function resolveCandidate(
	player: Player,
	query: string,
	source: SearchPlatform,
	requester: TrackRequester | undefined,
): Promise<{ track: Track | UnresolvedTrack | null; cached: boolean }> {
	const key = `${source}::${query.toLowerCase().trim()}`;

	const cached = searchCache.get(key);
	if (cached) {
		// Refresh LRU position.
		searchCache.delete(key);
		searchCache.set(key, cached);
		const copy = structuredClone(cached);
		copy.requester = requester;
		return { track: copy, cached: true };
	}

	const result = await player.search({ query, source }, requester).catch((error: unknown) => {
		logger.warn(`[Autoplay] Search failed for "${query}": ${error}`);
		return null;
	});

	const track = result?.tracks?.[0];
	if (!track) return { track: null, cached: false };

	// Skip caching UnresolvedTracks - see the note above.
	if (!("resolve" in track)) {
		const store = structuredClone(track as Track);
		store.requester = undefined;
		if (searchCache.size >= SEARCH_CACHE_LIMIT) {
			const oldest = searchCache.keys().next().value;
			if (oldest !== undefined) searchCache.delete(oldest);
		}
		searchCache.set(key, store);
	}

	return { track, cached: false };
}

/**
 * Renders the "Added by Autoplay" note for a now-playing embed, or "" for a
 * track someone actually requested.
 *
 * Shared by both now-playing renderers (the normal embed and the setup panel)
 * so an autoplayed track is labelled identically wherever it is displayed.
 */
export function autoplayNote(track: Track | UnresolvedTrack, locale?: string): string {
	const data = track.pluginInfo?.clientData as AutoplayClientData | undefined;
	if (!data?.fromAutoplay) return "";

	const text = data.autoplaySeed
		? t(I18N.player.trackStart.autoplay_from, { lng: locale, seed: data.autoplaySeed })
		: t(I18N.player.trackStart.autoplay, { lng: locale });

	return `\n-# ${text}`;
}

/**
 * Intelligent autoplay: queues tracks similar to the one that just finished.
 *
 * Ranking uses Last.fm's own `match` score, which `track.getsimilar` already
 * returns. The previous implementation discarded `match` and re-derived
 * similarity per candidate via `track.getInfo` + Jaccard over tags, which cost
 * one Last.fm call AND one Lavalink search per candidate - up to ~60 sequential
 * un-timed round trips per autoplayed track, ~30 of them YouTube searches. That
 * was both seconds of dead air and a fast way to earn YouTube's bot-check.
 *
 * Budget now: 1 Last.fm call, plus one Lavalink search per candidate actually
 * tried, hard-capped at MAX_SEARCH_ATTEMPTS and stopping as soon as the queue
 * has enough. Typically ~6 calls, worst case ~13.
 *
 * @param {Player} player The player instance.
 * @param {Track} lastTrack The last played track.
 * @returns {Promise<void>} A promise that resolves when the function is done.
 */
export async function autoPlayFunction(player: Player, lastTrack?: Track): Promise<void> {
	if (!player.get("autoplay")) return;
	if (!lastTrack) return;

	const lastfmApiKey = env.LASTFM_API_KEY;
	if (!lastfmApiKey) {
		logger.warn("[Autoplay] LASTFM_API_KEY is not set - autoplay cannot pick tracks.");
		return;
	}

	/** How many tracks to top the queue up to. */
	const MAX_TRACKS = 5;
	/** Ceiling on Lavalink searches, so a run of duplicates cannot fan out. */
	const MAX_SEARCH_ATTEMPTS = 12;
	/** Keep the dedupe window bounded. */
	const HISTORY_LIMIT = 50;

	// Two callers can reach this at once: the /autoplay command fires it
	// un-awaited to seed the queue, and lavalink-client fires it from
	// onEmptyQueue. Overlapping runs queued twice as many tracks, spent twice
	// the API budget, and could both pick the same candidate - the dedupe check
	// happens before the awaits, so neither run sees the other's picks.
	if (player.get<boolean>("autoplayInFlight")) {
		logger.debug?.("[Autoplay] Already running for this player - skipping duplicate run.");
		return;
	}
	player.set("autoplayInFlight", true);

	try {
		let autoplayHistory = player.get<Set<string>>("autoplayHistory");
		if (!autoplayHistory) {
			autoplayHistory = new Set<string>();
			player.set("autoplayHistory", autoplayHistory);
		}

		// One call. Already sorted by `match`, highest first.
		let candidates = await getSimilarTracks(lastTrack, lastfmApiKey, 30);

		// Obscure or very new tracks often have no similar-track data at all;
		// fall back to the artist's top tracks rather than giving up.
		if (candidates.length === 0 && lastTrack.info.author) {
			logger.info(
				`[Autoplay] No similar tracks; falling back to top tracks for ${lastTrack.info.author}`,
			);
			candidates = await getArtistTopTracks(lastTrack.info.author, lastfmApiKey);
		}

		if (candidates.length === 0) {
			logger.warn(
				`[Autoplay] No candidates for ${lastTrack.info.author} - ${lastTrack.info.title}`,
			);
			return;
		}

		// Drop anything we can already rule out from the Last.fm metadata alone -
		// this is free, and every candidate removed here is a search not made.
		const viable = candidates.filter(
			(c) =>
				!isTrackDuplicate(player, { info: { title: c.title, author: c.artist } }, autoplayHistory),
		);

		const tracksToAdd: (Track | UnresolvedTrack)[] = [];
		let attempts = 0;
		let cacheHits = 0;

		for (const candidate of viable) {
			if (tracksToAdd.length >= MAX_TRACKS || attempts >= MAX_SEARCH_ATTEMPTS) break;
			attempts++;

			const source = (player.get<SearchPlatform>("searchPlatform") ??
				"youtubemusic") as SearchPlatform;
			const { track, cached } = await resolveCandidate(
				player,
				candidate.query,
				source,
				lastTrack.requester,
			);
			if (!track) continue;
			if (cached) cacheHits++;

			// Re-check against the resolved track: the search may have landed on
			// something already queued under a different title.
			if (isTrackDuplicate(player, track, autoplayHistory)) continue;

			// `autoplaySeed` is what the UI shows as "based on ..." so the origin of
			// an autoplayed track is visible in Discord, not just in the logs.
			track.pluginInfo.clientData = {
				...(track.pluginInfo.clientData || {}),
				fromAutoplay: true,
				autoplaySeed: [lastTrack.info.author, lastTrack.info.title].filter(Boolean).join(" - "),
			};

			autoplayHistory.add(getTrackFingerprint(track));
			while (autoplayHistory.size > HISTORY_LIMIT) {
				const oldest = autoplayHistory.values().next().value;
				if (oldest === undefined) break;
				autoplayHistory.delete(oldest);
			}

			tracksToAdd.push(track);
		}

		if (tracksToAdd.length > 0) {
			await player.queue.add(tracksToAdd);
			logger.info(
				`[Autoplay] Queued ${tracksToAdd.length} track(s) from ${attempts} search(es), ${cacheHits} served from cache`,
			);
		} else {
			logger.warn(`[Autoplay] No suitable tracks after ${attempts} search(es)`);
		}
	} catch (error) {
		logger.error(`[Autoplay] Failed: ${error}`);
	} finally {
		player.set("autoplayInFlight", false);
	}
}

/**
 * Applies fair play to the player's queue by ensuring that tracks from different requesters are played in a round-robin fashion.
 * @param {Player} player The player instance.
 * @returns {Promise<Track[]>} A promise that resolves to the fair queue of tracks.
 */
export async function applyFairPlayToQueue(player: Player): Promise<Track[]> {
	const tracks = [...player.queue.tracks];
	const requesterMap = new Map<string, any[]>();

	// Group tracks by requester
	for (const track of tracks) {
		const requesterId = (track.requester as any).id;
		if (!requesterMap.has(requesterId)) {
			requesterMap.set(requesterId, []);
		}
		requesterMap.get(requesterId)?.push(track);
	}

	// Build fair queue
	const fairQueue: Track[] = [];
	const requesterIndices = new Map<string, number>();
	for (const requesterId of requesterMap.keys()) {
		requesterIndices.set(requesterId, 0);
	}

	let tracksAdded = 0;
	while (tracksAdded < tracks.length) {
		for (const [requesterId, trackList] of requesterMap.entries()) {
			const currentIndex = requesterIndices.get(requesterId)!;
			if (currentIndex < trackList.length) {
				fairQueue.push(trackList[currentIndex]);
				requesterIndices.set(requesterId, currentIndex + 1);
				tracksAdded++;
			}
		}
	}

	// Clear the player's queue and add the fair queue tracks
	await player.queue.splice(0, player.queue.tracks.length);
	await player.queue.add(fairQueue); // Add all tracks at once

	return fairQueue;
}
