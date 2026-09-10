const geniusLyrics = require("genius-lyrics-api");

import { env } from "../env";
import logger from "../structures/Logger";

/**
 * genius-lyrics-api uses axios with no default timeout, so a stalled Genius
 * request would hang the /lyrics command indefinitely, leaving the "loading"
 * message up forever. We cannot pass a signal into the library, so bound it
 * from the outside instead.
 */
const REQUEST_TIMEOUT_MS = 8000;

async function withTimeout<T>(label: string, work: Promise<T>): Promise<T | null> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			work,
			new Promise<never>((_, reject) => {
				timer = setTimeout(
					() => reject(new Error(`timed out after ${REQUEST_TIMEOUT_MS}ms`)),
					REQUEST_TIMEOUT_MS,
				);
			}),
		]);
	} catch (error) {
		logger.warn(`[Genius] ${label} failed: ${error}`);
		return null;
	} finally {
		if (timer) clearTimeout(timer);
	}
}

export interface GeniusSong {
	id: number;
	title: string;
	url: string;
	lyrics: string;
	albumArt: string;
}

export interface GeniusOptions {
	title: string;
	artist: string;
}

/**
 * Clean track name by removing common video tags and extras
 */
export function cleanTrackName(title: string): string {
	return (
		title
			// Remove content in brackets, parentheses, and curly braces
			.replace(/\[.*?\]|\(.*?\)|{.*?}/g, "")
			// Remove common video tags
			.replace(/official\s+(video|audio|lyric|music|visualizer)/gi, "")
			.replace(/\b(hd|hq|4k|8k|1080p|720p|480p|mv|m\/v)\b/gi, "")
			// Remove extra whitespace
			.replace(/\s+/g, " ")
			.trim()
	);
}

/**
 * Clean artist name by removing featuring artists and extras
 */
export function cleanArtistName(artist: string): string {
	return (
		artist
			// Remove content in brackets, parentheses, and curly braces
			.replace(/\[.*?\]|\(.*?\)|{.*?}/g, "")
			// Remove featuring/ft./feat. and everything after
			.replace(/\s+[-,&]\s+.*$/i, "")
			.replace(/\s+(ft\.?|feat\.?|featuring).*$/i, "")
			// Remove "- Topic" suffix from YouTube channels
			.replace(/\s+-\s+topic$/i, "")
			// Remove extra whitespace
			.replace(/\s+/g, " ")
			.trim()
	);
}

/**
 * Get song lyrics from Genius API
 * @param options Track title and artist
 * @returns Lyrics text or null if not found
 */
export async function getGeniusLyrics(options: GeniusOptions): Promise<string | null> {
	if (!env.GENIUS_API) {
		logger.warn("[Genius] GENIUS_API is not set - lyrics are unavailable.");
		return null;
	}

	const lyrics = await withTimeout<string>(
		"getLyrics",
		geniusLyrics.getLyrics({
			apiKey: env.GENIUS_API,
			title: cleanTrackName(options.title),
			artist: cleanArtistName(options.artist),
			optimizeQuery: true,
		}),
	);

	return lyrics ?? null;
}

/**
 * Get full song information from Genius API including lyrics
 * @param options Track title and artist
 * @returns Full song object with lyrics, album art, URL, etc.
 */
export async function getGeniusSong(options: GeniusOptions): Promise<GeniusSong | null> {
	if (!env.GENIUS_API) {
		logger.warn("[Genius] GENIUS_API is not set - lyrics are unavailable.");
		return null;
	}

	const song = await withTimeout<GeniusSong>(
		"getSong",
		geniusLyrics.getSong({
			apiKey: env.GENIUS_API,
			title: cleanTrackName(options.title),
			artist: cleanArtistName(options.artist),
			optimizeQuery: true,
		}),
	);

	return song ?? null;
}
