/** biome-ignore-all lint/style/noNonNullAssertion: <> */
import type { Player, Track } from "lavalink-client";
import type { Requester } from "../../types";
import { calculateTagSimilarity, getSimilarTracks, getTrackTags } from "../LastFm";

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
function getTrackFingerprint(track: Track | { info: { title: string; author: string } }): string {
	const title = track.info.title.toLowerCase().trim();
	const author = track.info.author.toLowerCase().trim();
	// Normalize by removing special characters and extra spaces
	const normalizedTitle = title.replace(/[^\w\s]/g, "").replace(/\s+/g, " ");
	const normalizedAuthor = author.replace(/[^\w\s]/g, "").replace(/\s+/g, " ");
	return `${normalizedAuthor}::${normalizedTitle}`;
}

/**
 * Checks if a track has been played or is in the queue
 */
function isTrackDuplicate(
	player: Player,
	track: Track | { info: { title: string; author: string } },
	autoplayHistory: Set<string>,
): boolean {
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

/**
 * Intelligent autoplay function that maintains genre consistency and avoids duplicates.
 * Features:
 * - No duplicate tracks (checks history, queue, and previous tracks)
 * - Genre consistency check every 3 tracks
 * - Adaptive learning based on recently played tracks
 * - Smart filtering and ranking
 *
 * @param {Player} player The player instance.
 * @param {Track} lastTrack The last played track.
 * @returns {Promise<void>} A promise that resolves when the function is done.
 */
export async function autoPlayFunction(player: Player, lastTrack?: Track): Promise<void> {
	if (!player.get("autoplay")) return;
	if (!lastTrack) return;

	// Get the Last.fm API key from environment via the manager's client
	const client = (player as any).LavalinkManager?.client;
	const lastfmApiKey = client?.env?.LASTFM_API_KEY;

	if (!lastfmApiKey) {
		console.warn("[Autoplay] Last.fm API key not found in environment. Autoplay disabled.");
		return;
	}

	try {
		// Initialize or get autoplay history
		let autoplayHistory = player.get<Set<string>>("autoplayHistory");
		if (!autoplayHistory) {
			autoplayHistory = new Set<string>();
			player.set("autoplayHistory", autoplayHistory);
		}

		// Track autoplay count for genre consistency checks
		let autoplayCount = player.get<number>("autoplayCount") || 0;
		autoplayCount++;
		player.set("autoplayCount", autoplayCount);

		// Get genre tags for recent tracks (for genre consistency)
		let recentGenres = player.get<string[]>("recentGenres");
		const shouldUpdateGenres = autoplayCount % 3 === 0 || !recentGenres; // Update every 3 tracks

		if (shouldUpdateGenres) {
			console.log("[Autoplay] Analyzing recent tracks for genre consistency...");
			const recentTracks = [lastTrack, ...player.queue.previous.slice(-4)]; // Last 5 tracks
			const allTags: string[] = [];

			for (const track of recentTracks) {
				const tags = await getTrackTags(track, lastfmApiKey);
				allTags.push(...tags);
			}

			// Count tag frequency
			const tagCounts = new Map<string, number>();
			for (const tag of allTags) {
				tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
			}

			// Get most common genres
			recentGenres = Array.from(tagCounts.entries())
				.sort((a, b) => b[1] - a[1])
				.slice(0, 5)
				.map(([tag]) => tag);

			player.set("recentGenres", recentGenres);
			console.log(`[Autoplay] Current genre profile: ${recentGenres.join(", ") || "none"}`);
		} else {
			recentGenres = recentGenres || [];
		}

		console.log(
			`[Autoplay] Finding similar tracks for: ${lastTrack.info.author} - ${lastTrack.info.title}`,
		);

		// Get similar tracks from Last.fm (get more for better filtering)
		const similarTracks = await getSimilarTracks(lastTrack, lastfmApiKey, 30);

		if (similarTracks.length === 0) {
			console.warn("[Autoplay] No similar tracks found via Last.fm");
			return;
		}

		// Try to add up to 5 tracks with intelligent filtering
		const tracksToAdd: Track[] = [];
		const maxTracks = 5;
		const minGenreSimilarity = 0.2; // 20% genre overlap required if we have genre data

		for (const similarTrack of similarTracks) {
			if (tracksToAdd.length >= maxTracks) break;

			// Check if this track is a duplicate
			const isDuplicate = isTrackDuplicate(
				player,
				{ info: { title: similarTrack.title, author: similarTrack.artist } },
				autoplayHistory,
			);

			if (isDuplicate) {
				continue;
			}

			try {
				// Search for the track
				const searchResult = await player.search(
					{
						query: similarTrack.query,
						source: player.get("searchPlatform") || "youtubemusic",
					},
					lastTrack.requester,
				);

				if (searchResult.tracks && searchResult.tracks.length > 0) {
					const track = searchResult.tracks[0];

					// Double-check for duplicates with the actual found track
					if (isTrackDuplicate(player, track, autoplayHistory)) {
						continue;
					}

					// Genre consistency check (if we have genre data and it's not the first few tracks)
					if (recentGenres.length > 0 && autoplayCount > 2) {
						const trackTags = await getTrackTags(track, lastfmApiKey);
						if (trackTags.length > 0) {
							const similarity = calculateTagSimilarity(recentGenres, trackTags);
							if (similarity < minGenreSimilarity) {
								console.log(
									`[Autoplay] Skipped ${track.info.author} - ${track.info.title} (genre mismatch: ${(similarity * 100).toFixed(0)}% similarity)`,
								);
								continue;
							}
						}
					}

					// Mark track as from autoplay
					track.pluginInfo.clientData = {
						...(track.pluginInfo.clientData || {}),
						fromAutoplay: true,
					};

					// Add to history
					const fingerprint = getTrackFingerprint(track);
					autoplayHistory.add(fingerprint);

					// Limit history size to last 50 tracks
					if (autoplayHistory.size > 50) {
						const firstItem = autoplayHistory.values().next().value;
						autoplayHistory.delete(firstItem);
					}

					tracksToAdd.push(track);
					console.log(`[Autoplay] Added: ${track.info.author} - ${track.info.title}`);
				}
			} catch (error) {
				console.warn(`[Autoplay] Failed to search for: ${similarTrack.query}`, error);
			}
		}

		if (tracksToAdd.length > 0) {
			await player.queue.add(tracksToAdd);
			console.log(`[Autoplay] Successfully added ${tracksToAdd.length} tracks to queue`);
		} else {
			console.warn("[Autoplay] No suitable tracks found after filtering");
		}
	} catch (error) {
		console.error("[Autoplay] Error in autoPlayFunction:", error);
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
