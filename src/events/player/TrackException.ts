import type { Player, Track, TrackExceptionEvent } from "lavalink-client";
import { Event, type Lavamusic } from "../../structures/index";
import { LavamusicEventType } from "../../types/events";

export default class TrackException extends Event {
	constructor(client: Lavamusic, file: string) {
		super(client, file, {
			type: LavamusicEventType.Player,
			// lavalink-client emits "trackError", not "trackException" - with the
			// old name this handler was registered against an event that never
			// fires, so playback failures were silently unlogged.
			name: "trackError",
		});
	}

	public async run(
		player: Player,
		track: Track | null,
		payload: TrackExceptionEvent,
	): Promise<void> {
		console.error("[TrackException] Track failed to play:", {
			guildId: player.guildId,
			track: track?.info?.title || "Unknown",
			trackSource: track?.info?.sourceName,
			error: payload.exception?.message,
			severity: payload.exception?.severity,
			cause: payload.exception?.cause,
		});

		// If the track is a Spotify track that failed, log more details
		if (track?.info?.sourceName === "spotify") {
			console.error("[TrackException] Spotify track details:", {
				title: track.info.title,
				artist: track.info.author,
				uri: track.info.uri,
				isrc: track.info.isrc,
			});
		}
	}
}
