import type { PluginObject } from "lavalink-client";
import { I18N } from "../../structures/I18n";
import { Command, type Context, type Lavamusic } from "../../structures/index";
import { EmbedLinks, ReadMessageHistory, SendMessages, ViewChannel } from "../../utils/Permissions";
import {
	CLIENT_IDENTIFIERS,
	PROBE_VIDEO_ID,
	type ProbeOutcome,
	probeClient,
} from "../../utils/YoutubeProbe";

export default class YoutubeHealth extends Command {
	constructor(client: Lavamusic) {
		super(client, {
			name: "ytdiag",
			description: {
				content: I18N.dev.ytdiag.description,
				examples: ["ytdiag"],
				usage: "ytdiag",
			},
			category: "dev",
			aliases: ["ythealth", "ytcheck"],
			// Each run makes up to nine real YouTube requests from the node, which
			// is exactly the traffic that earns a bot-check. Keep it infrequent.
			cooldown: 60,
			args: false,
			player: { voice: false, dj: false, active: false, djPerm: null },
			permissions: {
				dev: true,
				client: [SendMessages, ReadMessageHistory, ViewChannel, EmbedLinks],
				user: [],
			},
			slashCommand: false,
			options: [],
		});
	}

	public async run(client: Lavamusic, ctx: Context): Promise<void> {
		const node = [...client.manager.nodeManager.nodes.values()].find((n) => n.connected);
		if (!node) {
			await ctx.sendMessage({
				embeds: [
					this.client
						.embed()
						.setColor(this.client.color.red)
						.setDescription(ctx.locale(I18N.dev.ytdiag.no_node)),
				],
			});
			return;
		}

		await ctx.sendDeferMessage(ctx.locale(I18N.dev.ytdiag.probing));

		// Sequential on purpose: nine parallel YouTube requests from one IP is
		// precisely the burst pattern that trips the bot-check we are testing for.
		const outcomes: ProbeOutcome[] = [];
		for (const identifier of CLIENT_IDENTIFIERS) {
			outcomes.push(await probeClient(node.options, identifier));
		}

		const plugin = node.info?.plugins?.find((p: PluginObject) => p.name === "youtube-plugin");
		const working = outcomes.filter((o) => o.status === "ok");

		const lines = outcomes
			.filter((o) => o.status !== "unconfigured")
			.map((o) => `${o.status === "ok" ? "🟢" : "🔴"} \`${o.client}\` — ${o.detail}`);

		const unconfigured = outcomes.filter((o) => o.status === "unconfigured").map((o) => o.client);

		const embed = this.client
			.embed()
			.setColor(working.length > 0 ? this.client.color.main : this.client.color.red)
			.setDescription(
				[
					ctx.locale(I18N.dev.ytdiag.summary, {
						working: working.length,
						total: outcomes.length - unconfigured.length,
					}),
					`-# node \`${node.id}\` · youtube-plugin \`${plugin?.version ?? "not loaded"}\``,
					`-# probe video \`${PROBE_VIDEO_ID}\``,
					"",
					...lines,
					unconfigured.length
						? `\n-# not configured: ${unconfigured.map((c) => `\`${c}\``).join(", ")}`
						: "",
				]
					.filter(Boolean)
					.join("\n")
					.slice(0, 4000),
			);

		await ctx.editMessage({ embeds: [embed] });
	}
}
