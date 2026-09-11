import logger from "../structures/Logger";

/**
 * Minimal shape shared by `Track` and `UnresolvedTrack`. `UnresolvedTrackInfo`
 * extends `Partial<TrackInfo>` and only guarantees `title`, so `author` must be
 * treated as optional everywhere - reading it unguarded used to throw.
 */
export type TrackLike = { info: { title: string; author?: string } };

/** Every Last.fm request is bounded - an unbounded fetch here stalls autoplay. */
const REQUEST_TIMEOUT_MS = 5000;

/** Tag lookups are stable, so cache them for the process lifetime. */
const TAG_CACHE_LIMIT = 500;
const tagCache = new Map<string, string[]>();

/**
 * Similar-track lookups are cached too, which is what makes multi-seed autoplay
 * cheap: the seeds for this run are mostly the tracks that were already seeds on
 * previous runs, so in steady state only the newest seed is a fresh call.
 */
const SIMILAR_CACHE_LIMIT = 300;
const similarCache = new Map<string, SimilarCandidate[]>();

function remember<T>(cache: Map<string, T>, limit: number, key: string, value: T): T {
	if (cache.size >= limit) {
		const oldest = cache.keys().next().value;
		if (oldest !== undefined) cache.delete(oldest);
	}
	cache.set(key, value);
	return value;
}

interface LastFmSimilarTrack {
	name: string;
	artist: { name: string };
	match?: string;
}

interface LastFmSimilarResponse {
	similartracks?: { track: LastFmSimilarTrack[] };
	error?: number;
	message?: string;
}

interface LastFmTag {
	name: string;
	count?: number;
}

interface LastFmTrackInfoResponse {
	track?: {
		name: string;
		artist: { name: string };
		toptags?: { tag: LastFmTag[] };
	};
	error?: number;
	message?: string;
}

interface LastFmTopTracksResponse {
	toptracks?: { track: Array<{ name?: string; artist?: { name?: string } }> };
	error?: number;
	message?: string;
}

/** A similar-track candidate. `match` is Last.fm's own 0..1 similarity score. */
export interface SimilarCandidate {
	query: string;
	artist: string;
	title: string;
	/** Numeric form of Last.fm's `match`; 0 when absent or unparseable. */
	match: number;
}

/**
 * Cleans track name by removing extra info (features, remixes, etc.)
 */
export function cleanTrackName(trackName: string): string {
	return trackName
		.replace(/\(.*?\)/g, "") // Remove parentheses content
		.replace(/\[.*?\]/g, "") // Remove bracket content
		.replace(/feat\..*$/i, "") // Remove "feat." and everything after
		.replace(/ft\..*$/i, "") // Remove "ft." and everything after
		.replace(/\s*-\s*(official|audio|video|lyric|music|mv).*$/i, "") // Remove official video/audio tags
		.trim();
}

/**
 * Cleans artist name by taking the first artist
 */
export function cleanArtistName(artistName: string): string {
	return artistName.split(/[,&]/)[0].trim();
}

/**
 * Single entry point for Last.fm calls. Applies the timeout and turns every
 * failure - network, HTTP, API-level - into `null` so callers never throw into
 * the player.
 */
async function lastfmGet<T>(
	method: string,
	apiKey: string,
	params: Record<string, string>,
): Promise<T | null> {
	const url = new URL("https://ws.audioscrobbler.com/2.0/");
	url.searchParams.set("method", method);
	url.searchParams.set("api_key", apiKey);
	url.searchParams.set("format", "json");
	url.searchParams.set("autocorrect", "1");
	for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

	try {
		const response = await fetch(url.toString(), {
			signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
		});
		if (!response.ok) {
			logger.warn(`[LastFm] ${method} failed with HTTP ${response.status}`);
			return null;
		}
		const data = (await response.json()) as T & { error?: number; message?: string };
		if (data?.error) {
			logger.warn(`[LastFm] ${method} API error ${data.error}: ${data.message}`);
			return null;
		}
		return data;
	} catch (error) {
		const timedOut = error instanceof Error && error.name === "TimeoutError";
		logger.warn(`[LastFm] ${method} ${timedOut ? "timed out" : "failed"}: ${error}`);
		return null;
	}
}

/**
 * Fetches tags/genres for a track from Last.fm. Cached, because the same track
 * gets asked about repeatedly across a session.
 */
export async function getTrackTags(track: TrackLike, apiKey: string): Promise<string[]> {
	if (!apiKey) return [];

	const trackName = cleanTrackName(track.info.title ?? "");
	const artistName = cleanArtistName(track.info.author ?? "");
	if (!trackName || !artistName) return [];

	const cacheKey = `${artistName.toLowerCase()}::${trackName.toLowerCase()}`;
	const cached = tagCache.get(cacheKey);
	if (cached) return cached;

	const data = await lastfmGet<LastFmTrackInfoResponse>("track.getInfo", apiKey, {
		artist: artistName,
		track: trackName,
	});

	const tags = (data?.track?.toptags?.tag ?? []).slice(0, 5).map((tag) => tag.name.toLowerCase());

	// Cache negatives too - a track with no tags will not grow them mid-session.
	return remember(tagCache, TAG_CACHE_LIMIT, cacheKey, tags);
}

/**
 * Calculates Jaccard similarity between two sets of tags.
 * @returns Similarity score between 0 and 1
 */
export function calculateTagSimilarity(tags1: string[], tags2: string[]): number {
	if (tags1.length === 0 || tags2.length === 0) return 0;

	const set1 = new Set(tags1.map((t) => t.toLowerCase()));
	const set2 = new Set(tags2.map((t) => t.toLowerCase()));

	let matches = 0;
	for (const tag of set1) {
		if (set2.has(tag)) matches++;
	}

	const union = new Set([...set1, ...set2]).size;
	return matches / union;
}

/**
 * Fetches similar tracks from Last.fm, ranked by Last.fm's own `match` score
 * (highest first). That score is why callers do not need to re-derive
 * similarity per candidate.
 */
export async function getSimilarTracks(
	track: TrackLike,
	apiKey: string,
	limit = 30,
): Promise<SimilarCandidate[]> {
	if (!apiKey) {
		logger.warn("[LastFm] No API key provided, cannot fetch similar tracks");
		return [];
	}

	const trackName = cleanTrackName(track.info.title ?? "");
	const artistName = cleanArtistName(track.info.author ?? "");
	if (!trackName || !artistName) return [];

	const cacheKey = `${artistName.toLowerCase()}::${trackName.toLowerCase()}::${limit}`;
	const cached = similarCache.get(cacheKey);
	if (cached) return cached;

	const data = await lastfmGet<LastFmSimilarResponse>("track.getsimilar", apiKey, {
		artist: artistName,
		track: trackName,
		limit: String(limit),
	});

	const raw = data?.similartracks?.track ?? [];
	// A failed request must not be cached as "no similar tracks".
	if (data === null) return [];
	if (raw.length === 0) return remember(similarCache, SIMILAR_CACHE_LIMIT, cacheKey, []);

	const candidates = raw
		.filter((t) => t.name && t.artist?.name)
		.filter(
			(t) =>
				!(
					t.name.toLowerCase() === trackName.toLowerCase() &&
					t.artist.name.toLowerCase() === artistName.toLowerCase()
				),
		)
		.map((t) => ({
			query: `${t.artist.name} - ${t.name}`,
			artist: t.artist.name,
			title: t.name,
			match: Number.parseFloat(t.match ?? "0") || 0,
		}))
		.sort((a, b) => b.match - a.match);

	return remember(similarCache, SIMILAR_CACHE_LIMIT, cacheKey, candidates);
}

/**
 * Merges similar-track candidates from several seed tracks into one ranking.
 *
 * Weighted consensus replaces the old per-candidate genre check: a track that
 * several recent seeds agree on scores higher than one only the newest seed
 * suggested, which is what keeps a long autoplay chain from drifting - at the
 * cost of 2-3 cached Last.fm calls instead of ~30 uncached ones.
 *
 * @param seeds Candidate lists, most recent seed first.
 * @param weights Per-seed multipliers; the default decays with age.
 */
export function mergeSeedCandidates(
	seeds: SimilarCandidate[][],
	weights: number[] = [1, 0.6, 0.4],
): SimilarCandidate[] {
	const merged = new Map<string, SimilarCandidate & { seedCount: number }>();

	seeds.forEach((candidates, seedIndex) => {
		const weight = weights[seedIndex] ?? 0.25;
		for (const candidate of candidates) {
			const key = `${candidate.artist.toLowerCase()}::${candidate.title.toLowerCase()}`;
			const existing = merged.get(key);
			if (existing) {
				existing.match += candidate.match * weight;
				existing.seedCount++;
			} else {
				merged.set(key, {
					...candidate,
					match: candidate.match * weight,
					seedCount: 1,
				});
			}
		}
	});

	return (
		[...merged.values()]
			// Agreement across seeds outranks a single high score.
			.sort((a, b) => b.seedCount - a.seedCount || b.match - a.match)
			.map(({ seedCount: _seedCount, ...candidate }) => candidate)
	);
}

/**
 * Fetches top tracks for an artist. Used as the fallback when a track has no
 * similar-track data at all (obscure or newly released tracks).
 */
export async function getArtistTopTracks(
	artistName: string,
	apiKey: string,
	limit = 20,
): Promise<SimilarCandidate[]> {
	if (!apiKey) return [];

	const artist = cleanArtistName(artistName);
	if (!artist) return [];

	const data = await lastfmGet<LastFmTopTracksResponse>("artist.gettoptracks", apiKey, {
		artist,
		limit: String(limit),
	});

	return (data?.toptracks?.track ?? [])
		.filter((t): t is { name: string; artist: { name: string } } =>
			Boolean(t.name && t.artist?.name),
		)
		.map((t) => ({
			query: `${t.artist.name} - ${t.name}`,
			artist: t.artist.name,
			title: t.name,
			match: 0,
		}));
}
