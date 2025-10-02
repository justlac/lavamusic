/** biome-ignore-all lint/style/noNonNullAssertion: <> */
import type { Player, Track } from "lavalink-client";
import type { Requester } from "../../types";
import { env } from "../../env";

/**
 * Get similar tracks from Last.fm API
 * @param artist The artist name
 * @param track The track name
 * @returns Array of similar tracks
 */
async function getSimilarTracksFromLastFm(
	artist: string,
	track: string
): Promise<Array<{ artist: string; name: string }>> {
	try {
		const API_KEY = env.LASTFM_API_KEY;
		if (!API_KEY) {
			return [];
		}

		const encodedArtist = encodeURIComponent(artist);
		const encodedTrack = encodeURIComponent(track);
		const url = `https://ws.audioscrobbler.com/2.0/?method=track.getsimilar&artist=${encodedArtist}&track=${encodedTrack}&api_key=${API_KEY}&format=json&limit=10`;

		const response = await fetch(url);
		const data = await response.json();

		if (data.similartracks && data.similartracks.track) {
			const tracks = Array.isArray(data.similartracks.track)
				? data.similartracks.track
				: [data.similartracks.track];

			const similarTracks = tracks
				.filter((t: any) => t.artist && t.name)
				.map((t: any) => ({
					artist: typeof t.artist === "string" ? t.artist : t.artist.name,
					name: t.name,
				}))
				.slice(0, 10);

			return similarTracks;
		}

		return [];
	} catch (error) {
		return [];
	}
}

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
 * Function that will be called when the autoplay feature is enabled and the queue
 * is empty. It will search for tracks based on the last played track and add them
 * to the queue.
 *
 * @param {Player} player The player instance.
 * @param {Track} lastTrack The last played track.
 * @returns {Promise<void>} A promise that resolves when the function is done.
 */
export async function autoPlayFunction(player: Player, lastTrack?: Track): Promise<void> {
	if (!player.get("autoplay")) return;
	if (!lastTrack) return;

	// Use Last.fm API to get similar tracks for any source
	const similarTracks = await getSimilarTracksFromLastFm(lastTrack.info.author, lastTrack.info.title);

	if (similarTracks.length > 0) {
		const searchPromises = similarTracks.slice(0, 10).map(async (track: { artist: string; name: string }) => {
			try {
				const searchQuery = `${track.artist} ${track.name}`;
				const result = await player.search({ query: searchQuery, source: "ytmsearch" }, lastTrack.requester);
				return result.tracks && result.tracks.length > 0 ? result.tracks[0] : null;
			} catch {
				return null;
			}
		});

		const foundTracks = (await Promise.all(searchPromises))
			.filter((track: any) => track !== null)
			.filter((track: any) => {
				// Filter out lyrics versions
				const title = track.info.title.toLowerCase();
				return !title.includes("lyrics") && !title.includes("lyric");
			})
			.slice(0, 10)
			.map((track: any) => {
				track.pluginInfo = track.pluginInfo || {};
				track.pluginInfo.clientData = {
					...(track.pluginInfo.clientData || {}),
					fromAutoplay: true,
				};
				return track;
			});

		if (foundTracks.length > 0) {
			await player.queue.add(foundTracks);

			// Trigger playback if not playing
			if (!player.playing && player.queue.tracks.length > 0) {
				await player.play();
			}
			return;
		}
	}

	// Final fallback: search for artist's other popular songs
	const artistQuery = `${lastTrack.info.author} popular songs`;
	const fallbackRes = await player
		.search(
			{
				query: artistQuery,
				source: "ytmsearch",
			},
			lastTrack.requester
		)
		.catch(() => {
			return null;
		});

	if (fallbackRes && fallbackRes.tracks.length > 0) {
		// Filter and add tracks
		const cleanedTracks = fallbackRes.tracks
			.filter((track: any) => {
				const title = track.info.title.toLowerCase();
				return !title.includes("lyrics") && !title.includes("lyric");
			})
			.slice(0, 3)
			.map((track: any) => {
				track.pluginInfo = track.pluginInfo || {};
				track.pluginInfo.clientData = {
					...(track.pluginInfo.clientData || {}),
					fromAutoplay: true,
				};
				return track;
			});

		if (cleanedTracks.length > 0) {
			await player.queue.add(cleanedTracks);

			// Trigger playback if not playing
			if (!player.playing && player.queue.tracks.length > 0) {
				await player.play();
			}
		}
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

/**
 * Project: lavamusic
 * Author: Appu
 * Main Contributor: LucasB25
 * Company: Coders
 * Copyright (c) 2024. All rights reserved.
 * This code is the property of Coder and may not be reproduced or
 * modified without permission. For more information, contact us at
 * https://discord.gg/YQsGbTwPBx
 */
