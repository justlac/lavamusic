import {
	ActionRowBuilder,
	ButtonBuilder,
	type ButtonInteraction,
	ButtonStyle,
	ComponentType,
	ContainerBuilder,
	MessageFlags,
	SectionBuilder,
} from "discord.js";
import { I18N } from "../../structures/I18n";
import { Command, type Context, type Lavamusic } from "../../structures/index";
import { getGeniusSong } from "../../utils/Genius";
import {
	AttachFiles,
	EmbedLinks,
	ReadMessageHistory,
	SendMessages,
	ViewChannel,
} from "../../utils/Permissions";

export default class Lyrics extends Command {
	constructor(client: Lavamusic) {
		super(client, {
			name: "lyrics",
			description: {
				content: I18N.commands.lyrics.description,
				examples: ["lyrics", "lyrics song:Imagine Dragons - Believer"],
				usage: "lyrics [song]",
			},
			category: "music",
			aliases: ["ly"],
			cooldown: 3,
			args: false,
			vote: false,
			player: {
				voice: true,
				dj: false,
				active: false,
				djPerm: null,
			},
			permissions: {
				dev: false,
				client: [SendMessages, ReadMessageHistory, ViewChannel, EmbedLinks, AttachFiles],
				user: [],
			},
			slashCommand: true,
			options: [
				{
					name: "song",
					description: I18N.commands.lyrics.options.song,
					type: 3,
					required: false,
				},
			],
		});
	}

	public async run(client: Lavamusic, ctx: Context): Promise<any> {
		let songQuery = "";
		if (ctx.options && typeof ctx.options.get === "function") {
			let songOpt = null;
			try {
				songOpt = ctx.options.get("song");
			} catch (_err) {
				songOpt = null;
			}
			if (songOpt && typeof songOpt.value === "string") {
				songQuery = songOpt.value;
			}
		}
		if (!songQuery && ctx.args?.[0]) {
			songQuery = ctx.args.join(" ");
		}

		const player = client.manager.getPlayer(ctx.guild!.id);

		if (!songQuery && !player) {
			const noMusicContainer = new ContainerBuilder()
				.setAccentColor(client.color.red)
				.addTextDisplayComponents((textDisplay: any) =>
					textDisplay.setContent(ctx.locale(I18N.events.message.no_music_playing)),
				);
			return ctx.sendMessage({
				components: [noMusicContainer],
				flags: MessageFlags.IsComponentsV2,
			});
		}

		let trackTitle = "";
		let artistName = "";
		let trackUrl = "";
		let artworkUrl = "";

		// Get track info from song query or currently playing track
		if (songQuery) {
			// Parse song query (format: "Artist - Title" or just "Title")
			const parts = songQuery.split(" - ");
			if (parts.length >= 2) {
				artistName = parts[0].trim();
				trackTitle = parts.slice(1).join(" - ").trim();
			} else {
				trackTitle = songQuery.trim();
				artistName = "";
			}
		} else if (player?.queue.current) {
			const track = player.queue.current;
			trackTitle =
				(track.info.title?.replace(/\[.*?]|\(.*?\)|{.*?}/g, "").trim() as string) ||
				"Unknown Title";
			artistName =
				(track.info.author?.replace(/\[.*?]|\(.*?\)|{.*?}/g, "").trim() as string) ||
				"Unknown Artist";
			trackUrl = track.info.uri ?? "about:blank";
			artworkUrl = track.info.artworkUrl || "";
		}

		const searchingContainer = new ContainerBuilder()
			.setAccentColor(client.color.main)
			.addTextDisplayComponents((textDisplay: any) =>
				textDisplay.setContent(ctx.locale(I18N.commands.lyrics.searching, { trackTitle })),
			);

		await ctx.sendDeferMessage({
			components: [searchingContainer],
			flags: MessageFlags.IsComponentsV2,
		});

		try {
			// Fetch lyrics from Genius API
			const geniusSong = await getGeniusSong({
				title: trackTitle,
				artist: artistName,
			});

			if (!geniusSong || !geniusSong.lyrics || geniusSong.lyrics.length < 10) {
				const noResultsContainer = new ContainerBuilder()
					.setAccentColor(client.color.red)
					.addTextDisplayComponents((textDisplay: any) =>
						textDisplay.setContent(ctx.locale(I18N.commands.lyrics.errors.no_results)),
					);
				await ctx.editMessage({
					components: [noResultsContainer],
					flags: MessageFlags.IsComponentsV2,
				});
				return;
			}

			// Update track info with Genius data
			trackUrl = geniusSong.url;
			artworkUrl = geniusSong.albumArt || artworkUrl;
			const cleanedLyrics = this.cleanLyrics(geniusSong.lyrics);

			if (cleanedLyrics && cleanedLyrics.length > 0) {
				const lyricsPages = this.paginateLyrics(cleanedLyrics, ctx);
				let currentPage = 0;

				const createLyricsContainer = (pageIndex: number) => {
					const currentLyricsPage =
						lyricsPages[pageIndex] || ctx.locale(I18N.commands.lyrics.no_lyrics_on_page);

					let fullContent =
						ctx.locale(I18N.commands.lyrics.lyrics_for_track, {
							trackTitle: trackTitle,
							trackUrl: trackUrl,
						}) +
						"\n" +
						(artistName ? `*${artistName}*\n\n` : "") +
						`${currentLyricsPage}`;

					if (lyricsPages.length > 1) {
						fullContent += `\n\n${ctx.locale(I18N.commands.lyrics.page_indicator, {
							current: pageIndex + 1,
							total: lyricsPages.length,
						})}`;
					}

					const mainLyricsSection = new SectionBuilder().addTextDisplayComponents(
						(textDisplay: any) => textDisplay.setContent(fullContent),
					);

					if (artworkUrl && artworkUrl.length > 0) {
						mainLyricsSection.setThumbnailAccessory((thumbnail: any) =>
							thumbnail
								.setURL(artworkUrl)
								.setDescription(
									ctx.locale(I18N.commands.lyrics.artwork_description, { trackTitle }),
								),
						);
					}

					return new ContainerBuilder()
						.setAccentColor(client.color.main)
						.addSectionComponents(mainLyricsSection);
				};

				const getNavigationRow = (current: number) => {
					return new ActionRowBuilder<ButtonBuilder>().addComponents(
						new ButtonBuilder()
							.setCustomId("prev")
							.setEmoji(client.emoji.page.back)
							.setStyle(ButtonStyle.Secondary)
							.setDisabled(current === 0),
						new ButtonBuilder()
							.setCustomId("stop")
							.setEmoji(client.emoji.page.cancel)
							.setStyle(ButtonStyle.Danger),
						new ButtonBuilder()
							.setCustomId("next")
							.setEmoji(client.emoji.page.next)
							.setStyle(ButtonStyle.Secondary)
							.setDisabled(current === lyricsPages.length - 1),
					);
				};

				await ctx.editMessage({
					components: [createLyricsContainer(currentPage), getNavigationRow(currentPage)],
					flags: MessageFlags.IsComponentsV2,
				});

				const filter = (interaction: ButtonInteraction<"cached">) =>
					interaction.user.id === ctx.author?.id;
				let collectorActive = true;
				while (collectorActive) {
					try {
						const interaction = await ctx.channel.awaitMessageComponent({
							filter,
							componentType: ComponentType.Button,
							time: 300000, // 5 minutes instead of 1 minute
						});

						if (interaction.customId === "prev") {
							currentPage--;
						} else if (interaction.customId === "next") {
							currentPage++;
						} else if (interaction.customId === "stop") {
							collectorActive = false;
							await interaction.update({
								components: [createLyricsContainer(currentPage)],
							});
							break;
						}

						await interaction.update({
							components: [createLyricsContainer(currentPage), getNavigationRow(currentPage)],
						});
					} catch (_error) {
						// Timeout occurred - just disable the buttons but keep the lyrics visible
						collectorActive = false;
					}
				}

				// After timeout or stop, just remove the navigation buttons but keep lyrics visible
				if (ctx.guild?.members.me?.permissionsIn(ctx.channelId).has("SendMessages")) {
					await ctx
						.editMessage({
							components: [createLyricsContainer(currentPage)],
							flags: MessageFlags.IsComponentsV2,
						})
						.catch((e: any) => {
							if (e?.code !== 10008) {
								console.error("Failed to update lyrics message:", e);
							}
						});
				}
			} else {
				const noResultsContainer = new ContainerBuilder()
					.setAccentColor(client.color.red)
					.addTextDisplayComponents((textDisplay: any) =>
						textDisplay.setContent(ctx.locale(I18N.commands.lyrics.errors.no_results)),
					);
				await ctx.editMessage({
					components: [noResultsContainer],
					flags: MessageFlags.IsComponentsV2,
				});
			}
		} catch (error) {
			console.error(error);
			const errorContainer = new ContainerBuilder()
				.setAccentColor(client.color.red)
				.addTextDisplayComponents((textDisplay: any) =>
					textDisplay.setContent(ctx.locale(I18N.commands.lyrics.errors.lyrics_error)),
				);
			await ctx.editMessage({
				components: [errorContainer],
				flags: MessageFlags.IsComponentsV2,
			});
		}
	}

	paginateLyrics(lyrics: string, ctx: Context): string[] {
		const lines = lyrics.split("\n");
		const pages: string[] = [];
		let currentPage = "";
		const MAX_CHARACTERS_PER_PAGE = 2800;

		for (const line of lines) {
			const lineWithNewline = `${line}\n`;

			if (currentPage.length + lineWithNewline.length > MAX_CHARACTERS_PER_PAGE) {
				if (currentPage.trim()) {
					pages.push(currentPage.trim());
				}
				currentPage = lineWithNewline;
			} else {
				currentPage += lineWithNewline;
			}
		}

		if (currentPage.trim()) {
			pages.push(currentPage.trim());
		}

		if (pages.length === 0) {
			pages.push(ctx.locale(I18N.commands.lyrics.no_lyrics_available));
		}

		return pages;
	}

	private cleanLyrics(lyrics: string): string {
		const cleaned = lyrics
			.replace(/^(\d+\s*Contributors.*?Lyrics|.*Contributors.*|Lyrics\s*|.*Lyrics\s*)$/gim, "")
			.replace(/^[\s\n\r]+/, "")
			.replace(/[\s\n\r]+$/, "")
			.replace(/\n{3,}/g, "\n\n");
		return cleaned.trim();
	}
}
