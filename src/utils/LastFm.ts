import type { Track } from "lavalink-client";

interface LastFmSimilarTrack {
	name: string;
	artist: {
		name: string;
	};
	match?: string;
}

interface LastFmSimilarResponse {
	similartracks?: {
		track: LastFmSimilarTrack[];
	};
	error?: number;
	message?: string;
}

interface LastFmTag {
	name: string;
	count?: number;
}

interface LastFmTrackInfo {
	name: string;
	artist: {
		name: string;
	};
	toptags?: {
		tag: LastFmTag[];
	};
}

interface LastFmTrackInfoResponse {
	track?: LastFmTrackInfo;
	error?: number;
	message?: string;
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
 * Fetches tags/genres for a track from Last.fm
 * @param track The track to get tags for
 * @param apiKey The Last.fm API key
 * @returns Array of genre tags
 */
export async function getTrackTags(track: Track, apiKey: string): Promise<string[]> {
	if (!apiKey || apiKey === "") {
		return [];
	}

	const trackName = cleanTrackName(track.info.title);
	const artistName = cleanArtistName(track.info.author);

	try {
		const url = new URL("https://ws.audioscrobbler.com/2.0/");
		url.searchParams.append("method", "track.getInfo");
		url.searchParams.append("artist", artistName);
		url.searchParams.append("track", trackName);
		url.searchParams.append("api_key", apiKey);
		url.searchParams.append("format", "json");
		url.searchParams.append("autocorrect", "1");

		const response = await fetch(url.toString());

		if (!response.ok) {
			return [];
		}

		const data: LastFmTrackInfoResponse = await response.json();

		if (data.error || !data.track?.toptags?.tag) {
			return [];
		}

		// Get top 5 tags
		const tags = data.track.toptags.tag.slice(0, 5).map((tag) => tag.name.toLowerCase());

		return tags;
	} catch (error) {
		console.warn("[LastFm] Error fetching track tags:", error);
		return [];
	}
}

/**
 * Calculates similarity between two sets of tags
 * @param tags1 First set of tags
 * @param tags2 Second set of tags
 * @returns Similarity score between 0 and 1
 */
export function calculateTagSimilarity(tags1: string[], tags2: string[]): number {
	if (tags1.length === 0 || tags2.length === 0) {
		return 0;
	}

	const set1 = new Set(tags1.map((t) => t.toLowerCase()));
	const set2 = new Set(tags2.map((t) => t.toLowerCase()));

	let matches = 0;
	for (const tag of set1) {
		if (set2.has(tag)) {
			matches++;
		}
	}

	// Jaccard similarity: intersection / union
	const union = new Set([...set1, ...set2]).size;
	return matches / union;
}

/**
 * Fetches similar tracks from Last.fm based on a given track
 * @param track The current track to find similar tracks for
 * @param apiKey The Last.fm API key
 * @param limit Maximum number of similar tracks to return (default: 10)
 * @returns Array of similar track search queries with metadata
 */
export async function getSimilarTracks(
	track: Track,
	apiKey: string,
	limit = 10,
): Promise<Array<{ query: string; artist: string; title: string; match?: string }>> {
	if (!apiKey || apiKey === "") {
		console.warn("[LastFm] No API key provided, cannot fetch similar tracks");
		return [];
	}

	const trackName = cleanTrackName(track.info.title);
	const artistName = cleanArtistName(track.info.author);

	try {
		const url = new URL("https://ws.audioscrobbler.com/2.0/");
		url.searchParams.append("method", "track.getsimilar");
		url.searchParams.append("artist", artistName);
		url.searchParams.append("track", trackName);
		url.searchParams.append("api_key", apiKey);
		url.searchParams.append("format", "json");
		url.searchParams.append("limit", limit.toString());
		url.searchParams.append("autocorrect", "1");

		const response = await fetch(url.toString());

		if (!response.ok) {
			console.warn(`[LastFm] API request failed with status ${response.status}`);
			return [];
		}

		const data: LastFmSimilarResponse = await response.json();

		if (data.error) {
			console.warn(`[LastFm] API error: ${data.message}`);
			return [];
		}

		if (!data.similartracks || !data.similartracks.track || data.similartracks.track.length === 0) {
			console.warn(`[LastFm] No similar tracks found for: ${artistName} - ${trackName}`);
			return [];
		}

		// Convert Last.fm results to track objects
		const tracks = data.similartracks.track
			.filter((t) => t.name && t.artist?.name)
			.filter((t) => {
				// Filter out the original track
				const isSameTrack =
					t.name.toLowerCase() === trackName.toLowerCase() &&
					t.artist.name.toLowerCase() === artistName.toLowerCase();
				return !isSameTrack;
			})
			.map((t) => ({
				query: `${t.artist.name} - ${t.name}`,
				artist: t.artist.name,
				title: t.name,
				match: t.match,
			}));

		console.log(`[LastFm] Found ${tracks.length} similar tracks for: ${artistName} - ${trackName}`);

		return tracks;
	} catch (error) {
		console.error("[LastFm] Error fetching similar tracks:", error);
		return [];
	}
}

/**
 * Fetches top tracks from an artist using Last.fm
 * @param artistName The artist name
 * @param apiKey The Last.fm API key
 * @param limit Maximum number of tracks to return (default: 10)
 * @returns Array of track search queries
 */
export async function getArtistTopTracks(
	artistName: string,
	apiKey: string,
	limit = 10,
): Promise<string[]> {
	if (!apiKey || apiKey === "") {
		console.warn("[LastFm] No API key provided, cannot fetch artist top tracks");
		return [];
	}

	const cleanArtistName = artistName.split(/[,&]/)[0].trim();

	try {
		const url = new URL("https://ws.audioscrobbler.com/2.0/");
		url.searchParams.append("method", "artist.gettoptracks");
		url.searchParams.append("artist", cleanArtistName);
		url.searchParams.append("api_key", apiKey);
		url.searchParams.append("format", "json");
		url.searchParams.append("limit", limit.toString());
		url.searchParams.append("autocorrect", "1");

		const response = await fetch(url.toString());

		if (!response.ok) {
			console.warn(`[LastFm] API request failed with status ${response.status}`);
			return [];
		}

		const data: any = await response.json();

		if (data.error) {
			console.warn(`[LastFm] API error: ${data.message}`);
			return [];
		}

		if (!data.toptracks || !data.toptracks.track || data.toptracks.track.length === 0) {
			console.warn(`[LastFm] No top tracks found for artist: ${cleanArtistName}`);
			return [];
		}

		const searchQueries = data.toptracks.track
			.filter((t: any) => t.name && t.artist?.name)
			.map((t: any) => `${t.artist.name} - ${t.name}`);

		console.log(`[LastFm] Found ${searchQueries.length} top tracks for artist: ${cleanArtistName}`);

		return searchQueries;
	} catch (error) {
		console.error("[LastFm] Error fetching artist top tracks:", error);
		return [];
	}
}
