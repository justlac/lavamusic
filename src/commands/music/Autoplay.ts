import { I18N } from "../../structures/I18n";
import { Command, type Context, type Lavamusic } from "../../structures/index";
import { autoPlayFunction } from "../../utils/functions/player";
import { EmbedLinks, ReadMessageHistory, SendMessages, ViewChannel } from "../../utils/Permissions";

export default class Autoplay extends Command {
	constructor(client: Lavamusic) {
		super(client, {
			name: "autoplay",
			description: {
				content: I18N.commands.autoplay.description,
				examples: ["autoplay"],
				usage: "autoplay",
			},
			category: "music",
			aliases: ["ap"],
			cooldown: 3,
			args: false,
			vote: true,
			player: {
				voice: true,
				dj: true,
				active: true,
				djPerm: null,
			},
			permissions: {
				dev: false,
				client: [SendMessages, ReadMessageHistory, ViewChannel, EmbedLinks],
				user: [],
			},
			slashCommand: true,
			options: [],
		});
	}

	public async run(client: Lavamusic, ctx: Context): Promise<any> {
		const player = client.manager.getPlayer(ctx.guild.id);
		if (!player) {
			return await ctx.sendMessage({
				embeds: [
					{
						description: ctx.locale(I18N.player.errors.no_player),
						color: this.client.color.red,
					},
				],
			});
		}

		const embed = this.client.embed();
		const autoplay = player.get<boolean>("autoplay");

		player.set("autoplay", !autoplay);

		if (autoplay) {
			// Disabling autoplay
			embed
				.setDescription(ctx.locale(I18N.commands.autoplay.messages.disabled))
				.setColor(this.client.color.main);
		} else {
			// Enabling autoplay - immediately queue tracks
			embed
				.setDescription(ctx.locale(I18N.commands.autoplay.messages.enabled))
				.setColor(this.client.color.main);

			// Immediately trigger autoplay if there's a current track
			const currentTrack = player.queue.current;
			if (currentTrack) {
				// Run autoplay function asynchronously without blocking the response
				autoPlayFunction(player, currentTrack).catch((error) => {
					console.error("[Autoplay Command] Error queuing initial tracks:", error);
				});
			}
		}

		await ctx.sendMessage({ embeds: [embed] });
	}
}
