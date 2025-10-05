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
import { Command, type Context, type Lavamusic } from "../../structures/index";

export default class Lyrics extends Command {
	constructor(client: Lavamusic) {
		super(client, {
			name: "lyrics",
			description: {
				content: "cmd.lyrics.description",
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
				client: ["SendMessages", "ReadMessageHistory", "ViewChannel", "EmbedLinks", "AttachFiles"],
				user: [],
			},
			slashCommand: true,
			options: [
				{
					name: "song",
					description: "cmd.lyrics.options.song.description",
					type: 3,
					required: false,
				},
			],
		});
	}

	// --- Genius Lyrics Fetch Helper ---
	async fetchLyricsFromGenius(title: string, artist: string, accessToken: string): Promise<string | null> {
		const query = artist ? `${title} ${artist}` : title;
		const searchUrl = `https://api.genius.com/search?q=${encodeURIComponent(query)}`;

		let searchRes;
		try {
			searchRes = await fetch(searchUrl, {
				headers: { Authorization: `Bearer ${accessToken}` },
			});
		} catch (err) {
			return null;
		}
		if (!searchRes.ok) {
			return null;
		}
		const searchData = await searchRes.json();
		const hit = searchData.response.hits?.[0]?.result;
		if (!hit || !hit.url) {
			return null;
		}

		let pageRes;
		try {
			pageRes = await fetch(hit.url);
		} catch (err) {
			return null;
		}
		if (!pageRes.ok) {
			return null;
		}
		const pageHtml = await pageRes.text();
		// Try current Genius structure: data-lyrics-container="true"
		let matches = [...pageHtml.matchAll(/<div data-lyrics-container="true"[^>]*>([\s\S]*?)<\/div>/g)];
		if (!matches.length) {
			// Fallback to old Lyrics__Container class
			matches = [...pageHtml.matchAll(/<div class="Lyrics__Container[^>]*>([\s\S]*?)<\/div>/g)];
		}
		if (!matches.length) {
			return null;
		}
		const lyrics = matches
			.map((m) =>
				m[1]
					.replace(/<br\s*\/?>(\s*)?/gi, "\n")
					.replace(/<a[^>]*>/g, "")
					.replace(/<\/a>/g, "")
					.replace(/<span[^>]*>/g, "")
					.replace(/<\/span>/g, "")
					.replace(/<div[^>]*>/g, "")
					.replace(/<\/div>/g, "")
					.replace(/<[^>]+>/g, "")
					.replace(/&amp;/g, "&")
					.replace(/&#x27;/g, "'")
					.replace(/&lt;/g, "<")
					.replace(/&gt;/g, ">")
					.replace(/&quot;/g, '"')
			)
			.join("\n")
			.trim();
		return lyrics.length > 0 ? lyrics : null;
	}

	public async run(client: Lavamusic, ctx: Context): Promise<any> {
		// Get the song query from options or arguments
		let songQuery = "";
		if (ctx.options && typeof ctx.options.get === "function") {
			let songOpt = null;
			try {
				songOpt = ctx.options.get("song");
			} catch (e) {
				songOpt = null;
			}
			if (songOpt && typeof songOpt.value === "string") {
				songQuery = songOpt.value;
			}
		}
		if (!songQuery && ctx.args?.[0]) {
			songQuery = ctx.args[0];
		}

		const player = client.manager.getPlayer(ctx.guild!.id);

		// If there is no player and no song title is given, lyrics cannot be fetched
		if (!songQuery && !player) {
			const noMusicContainer = new ContainerBuilder()
				.setAccentColor(client.color.red)
				.addTextDisplayComponents((textDisplay) =>
					textDisplay.setContent(ctx.locale("event.message.no_music_playing"))
				);
			return ctx.sendMessage({
				components: [noMusicContainer],
				flags: MessageFlags.IsComponentsV2,
			});
		}
		// Use Genius as the only lyrics source
		let trackTitle = "";
		let artistName = "";
		let trackUrl = "";
		let artworkUrl = "";
		if (player && player.queue.current) {
			const track = player.queue.current;
			trackTitle = track.info.title || songQuery;
			artistName = track.info.author || "";
			trackUrl = track.info.uri || "";
			artworkUrl = track.info.artworkUrl || "";
		} else {
			trackTitle = songQuery;
		}
		const geniusToken = process.env.GENIUS_API || client.env.GENIUS_API;
		if (!geniusToken) {
			const noTokenContainer = new ContainerBuilder()
				.setAccentColor(client.color.red)
				.addTextDisplayComponents((textDisplay) =>
					textDisplay.setContent("Genius API token is not set in the environment!")
				);
			return ctx.sendMessage({
				components: [noTokenContainer],
				flags: MessageFlags.IsComponentsV2,
			});
		}
		const lyricsResult = await this.fetchLyricsFromGenius(trackTitle, artistName, geniusToken);

		const searchingContainer = new ContainerBuilder()
			.setAccentColor(client.color.main)
			.addTextDisplayComponents((textDisplay) =>
				textDisplay.setContent(ctx.locale("cmd.lyrics.searching", { trackTitle }))
			);

		await ctx.sendDeferMessage({
			components: [searchingContainer],
			flags: MessageFlags.IsComponentsV2,
		});

		try {
			// lyricsResult is now always a string or null
			let lyricsText: string | null = lyricsResult;
			if (!lyricsText || lyricsText.length < 10) {
				const noResultsContainer = new ContainerBuilder()
					.setAccentColor(client.color.red)
					.addTextDisplayComponents((textDisplay) =>
						textDisplay.setContent(ctx.locale("cmd.lyrics.errors.no_results"))
					);
				await ctx.editMessage({
					components: [noResultsContainer],
					flags: MessageFlags.IsComponentsV2,
				});
				return;
			}
			const cleanedLyrics = this.cleanLyrics(lyricsText);

			if (cleanedLyrics && cleanedLyrics.length > 0) {
				const lyricsPages = this.paginateLyrics(cleanedLyrics, ctx);
				let currentPage = 0;

				const createLyricsContainer = (pageIndex: number, finalState: boolean = false) => {
					const currentLyricsPage = lyricsPages[pageIndex] || ctx.locale("cmd.lyrics.no_lyrics_on_page");

					let fullContent =
						ctx.locale("cmd.lyrics.lyrics_for_track", {
							trackTitle: trackTitle,
							trackUrl: trackUrl,
						}) +
						"\n" +
						(artistName ? `*${artistName}*\n\n` : "") +
						`${currentLyricsPage}`;

					if (!finalState) {
						fullContent += `\n\n${ctx.locale("cmd.lyrics.page_indicator", {
							current: pageIndex + 1,
							total: lyricsPages.length,
						})}`;
					} else {
						fullContent += `\n\n*${ctx.locale("cmd.lyrics.session_expired")}*`;
					}

					const mainLyricsSection = new SectionBuilder().addTextDisplayComponents((textDisplay) =>
						textDisplay.setContent(fullContent)
					);

					if (artworkUrl && artworkUrl.length > 0) {
						mainLyricsSection.setThumbnailAccessory((thumbnail) =>
							thumbnail
								.setURL(artworkUrl)
								.setDescription(ctx.locale("cmd.lyrics.artwork_description", { trackTitle }))
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
							.setDisabled(current === lyricsPages.length - 1)
					);
				};

				// Only show navigation, no live lyrics/subscribe logic
				await ctx.editMessage({
					components: [createLyricsContainer(currentPage), getNavigationRow(currentPage)],
					flags: MessageFlags.IsComponentsV2,
				});

				const filter = (interaction: ButtonInteraction<"cached">) => interaction.user.id === ctx.author?.id;
				let collectorActive = true;
				while (collectorActive) {
					try {
						const interaction = await ctx.channel.awaitMessageComponent({
							filter,
							componentType: ComponentType.Button,
							time: 60000,
						});
						if (interaction.customId === "prev") {
							currentPage--;
						} else if (interaction.customId === "next") {
							currentPage++;
						} else if (interaction.customId === "stop") {
							collectorActive = false;
							await interaction.update({
								components: [createLyricsContainer(currentPage, true), getNavigationRow(currentPage)],
							});
							break;
						}
						await interaction.update({
							components: [createLyricsContainer(currentPage), getNavigationRow(currentPage)],
						});
					} catch (e) {
						collectorActive = false;
					}
				}
				// After collecting is finished
				if (ctx.guild?.members.me?.permissionsIn(ctx.channelId).has("SendMessages")) {
					const finalContainer = createLyricsContainer(currentPage, true);
					await ctx
						.editMessage({
							components: [finalContainer],
							flags: MessageFlags.IsComponentsV2,
						})
						.catch((e) => {
							if (e?.code !== 10008) {
								client.logger.error("Failed to clear lyrics buttons:", e);
							}
						});
				}
			} else {
				const noResultsContainer = new ContainerBuilder()
					.setAccentColor(client.color.red)
					.addTextDisplayComponents((textDisplay) =>
						textDisplay.setContent(ctx.locale("cmd.lyrics.errors.no_results"))
					);
				await ctx.editMessage({
					components: [noResultsContainer],
					flags: MessageFlags.IsComponentsV2,
				});
			}
		} catch (error) {
			client.logger.error(error);
			const errorContainer = new ContainerBuilder()
				.setAccentColor(client.color.red)
				.addTextDisplayComponents((textDisplay) =>
					textDisplay.setContent(ctx.locale("cmd.lyrics.errors.lyrics_error"))
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
			pages.push(ctx.locale("cmd.lyrics.no_lyrics_available"));
		}

		return pages;
	}

	private cleanLyrics(lyrics: string): string {
		let cleaned = lyrics
			.replace(/^(\d+\s*Contributors.*?Lyrics|.*Contributors.*|Lyrics\s*|.*Lyrics\s*)$/gim, "")
			.replace(/^[\s\n\r]+/, "")
			.replace(/[\s\n\r]+$/, "")
			.replace(/\n{3,}/g, "\n\n");
		return cleaned.trim();
	}
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
