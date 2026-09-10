import { EmbedBuilder, type TextChannel } from "discord.js";
import type { Player, Track, TrackExceptionEvent } from "lavalink-client";
import { I18N, t } from "../../structures/I18n";
import { Event, type Lavamusic } from "../../structures/index";
import logger from "../../structures/Logger";
import { LavamusicEventType } from "../../types/events";

/**
 * The failure classes worth telling a human about. Each maps to one of the four
 * gates a YouTube playback request has to clear, so the message names what
 * actually broke instead of dumping a Java exception into chat.
 */
type FailureKind = "botcheck" | "cipher" | "noformats" | "client" | "restricted" | "unknown";

/** Matched against the Lavalink exception message, most specific first. */
const FAILURE_PATTERNS: Array<{ kind: FailureKind; pattern: RegExp }> = [
	// Gate 3 - IP reputation. Usually transient, and not the user's fault.
	{ kind: "botcheck", pattern: /sign in to confirm|not a bot/i },
	// Gate 2 - the plugin could not read YouTube's signature functions.
	{ kind: "cipher", pattern: /must find sig|scriptextraction|cipher|signature/i },
	// Gate 4 - response carried no plain-URL format (SABR-only).
	{ kind: "noformats", pattern: /could not find formats|no playable|sabr/i },
	// Gate 1 - the impersonated client identity was rejected.
	{
		kind: "client",
		pattern: /page needs to be reloaded|failed_precondition|all ?clients ?failed|http 400/i,
	},
	// Not a gate - the video itself is unavailable to anyone anonymous.
	{
		kind: "restricted",
		pattern: /requires login|age.?restrict|private|unavailable|copyright|blocked/i,
	},
];

function classifyFailure(message?: string | null): FailureKind {
	if (!message) return "unknown";
	for (const { kind, pattern } of FAILURE_PATTERNS) {
		if (pattern.test(message)) return kind;
	}
	return "unknown";
}

/**
 * Don't flood the channel. A broken node fails every track in the queue back to
 * back, and one explanation is as useful as thirty.
 */
const NOTICE_COOLDOWN_MS = 30_000;

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
		const message = payload.exception?.message;
		const kind = classifyFailure(message);

		logger.error(
			`[TrackError] ${kind} | guild=${player.guildId} | ${track?.info?.author ?? "?"} - ${
				track?.info?.title ?? "Unknown"
			} | source=${track?.info?.sourceName ?? "?"} | severity=${
				payload.exception?.severity ?? "?"
			} | ${message ?? "no message"}`,
		);

		await this.notify(player, track, kind);
	}

	/**
	 * Tells the channel, in one sentence, which gate closed - so "the bot is
	 * broken" becomes something diagnosable without reading server logs.
	 */
	private async notify(player: Player, track: Track | null, kind: FailureKind): Promise<void> {
		// Suppress repeats of the same failure class while a node is unhealthy.
		const lastKind = player.get<FailureKind>("lastFailureKind");
		const lastAt = player.get<number>("lastFailureAt") ?? 0;
		if (lastKind === kind && Date.now() - lastAt < NOTICE_COOLDOWN_MS) return;
		player.set("lastFailureKind", kind);
		player.set("lastFailureAt", Date.now());

		if (!player.textChannelId) return;
		const guild = this.client.guilds.cache.get(player.guildId);
		if (!guild) return;
		const channel = guild.channels.cache.get(player.textChannelId) as TextChannel | undefined;
		if (!channel) return;

		const locale = await this.client.db.getLanguage(guild.id).catch(() => undefined);
		const reason = t(I18N.player.errors.playback_failed_reasons[kind], { lng: locale });
		const title = track?.info?.title ?? t(I18N.player.errors.unknown_track, { lng: locale });

		const embed = new EmbedBuilder()
			.setColor(this.client.color.red)
			.setDescription(
				`${t(I18N.player.errors.playback_failed, { lng: locale, title })}\n-# ${reason}`,
			);

		// The channel may be gone, or we may have lost Send permission.
		await channel.send({ embeds: [embed] }).catch(() => null);
	}
}
