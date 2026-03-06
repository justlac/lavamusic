const geniusLyrics = require("genius-lyrics-api");

import { env } from "../env";

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
		console.error("[Genius] GENIUS_API key is not configured in .env");
		return null;
	}

	try {
		const cleanTitle = cleanTrackName(options.title);
		const cleanArtist = cleanArtistName(options.artist);

		const lyrics = await geniusLyrics.getLyrics({
			apiKey: env.GENIUS_API,
			title: cleanTitle,
			artist: cleanArtist,
			optimizeQuery: true,
		});

		if (lyrics) {
			return lyrics;
		}

		return null;
	} catch (error) {
		console.error(`[Genius] Error fetching lyrics: ${error}`);
		return null;
	}
}

/**
 * Get full song information from Genius API including lyrics
 * @param options Track title and artist
 * @returns Full song object with lyrics, album art, URL, etc.
 */
export async function getGeniusSong(options: GeniusOptions): Promise<GeniusSong | null> {
	if (!env.GENIUS_API) {
		console.error("[Genius] GENIUS_API key is not configured in .env");
		return null;
	}

	try {
		const cleanTitle = cleanTrackName(options.title);
		const cleanArtist = cleanArtistName(options.artist);

		const song = await geniusLyrics.getSong({
			apiKey: env.GENIUS_API,
			title: cleanTitle,
			artist: cleanArtist,
			optimizeQuery: true,
		});

		if (song) {
			return song;
		}

		return null;
	} catch (error) {
		console.error(`[Genius] Error fetching song: ${error}`);
		return null;
	}
}
