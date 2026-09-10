/**
 * Manual verification for the /ytdiag probe. Not part of `bun test` (it needs a
 * live Lavalink node); run it against the throwaway rig:
 *   bun run tests/manual-ytdiag.ts
 */
import { CLIENT_IDENTIFIERS, probeClient } from "../src/utils/YoutubeProbe";

const options = {
	host: process.env.RIG_HOST ?? "127.0.0.1",
	port: Number(process.env.RIG_PORT ?? 2333),
	authorization: process.env.RIG_PASS ?? "youshallnotpass",
	secure: false,
};

for (const client of CLIENT_IDENTIFIERS) {
	const outcome = await probeClient(options, client);
	const icon = outcome.status === "ok" ? "OK  " : outcome.status === "unconfigured" ? "n/a " : "FAIL";
	console.log(`${icon} ${client.padEnd(22)} ${outcome.detail}`);
}
