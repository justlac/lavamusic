import { type ButtonInteraction, MessageFlags } from "discord.js";
import { Component, type Lavamusic } from "../../structures";
import { I18N, t } from "../../structures/I18n";
import { handlePlayerInteraction, updatePlayerMessage } from "../../utils/PlayerUIUtils";

export default class SkipButton extends Component {
	constructor(client: Lavamusic) {
		super(client, {
			name: "skip",
			aliases: ["SKIP_BUT"],
		});
	}

	public async run(interaction: ButtonInteraction): Promise<any> {
		const player = await handlePlayerInteraction(this.client, interaction);
		if (!player) return;

		const autoplay = player.get<boolean>("autoplay");
		const currentTrack = player.queue.current;

		if (player.queue.tracks.length > 0) {
			await interaction.deferUpdate();
			player.skip();
			// Wrap in try-catch to handle message deletion race condition
			try {
				await updatePlayerMessage(
					this.client,
					interaction,
					player,
					t(I18N.player.trackStart.skipped_by, { user: interaction.user.tag }),
				);
			} catch (error) {
				// Silently ignore - message may have been deleted by TrackEnd event
			}
		} else if (autoplay && currentTrack) {
			// Queue is empty but autoplay is on. skip() throws RangeError on an
			// empty queue (and was not awaited here, so it surfaced as an
			// unhandled rejection) - stopPlaying triggers the next track instead.
			await interaction.deferUpdate();
			await player.stopPlaying(false, true);

			// Wrap in try-catch to handle message deletion race condition
			try {
				await updatePlayerMessage(
					this.client,
					interaction,
					player,
					t(I18N.player.trackStart.skipped_by, { user: interaction.user.tag }),
				);
			} catch (error) {
				// Silently ignore - message may have been deleted by TrackEnd event
			}
		} else {
			await interaction.reply({
				content: t(I18N.player.trackStart.no_more_songs_in_queue),
				flags: MessageFlags.Ephemeral,
			});
		}
	}
}
