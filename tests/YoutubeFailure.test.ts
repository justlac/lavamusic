import { describe, expect, test } from "bun:test";
import { classifyFailure, FAILURE_GATE } from "../src/utils/YoutubeFailure";

/**
 * Every message below was observed from a real Lavalink node running
 * youtube-source, not invented - if these stop classifying, the in-chat
 * explanations silently degrade to "unclassified".
 */
describe("classifyFailure", () => {
	test("gate 3 - bot check", () => {
		expect(classifyFailure("Sign in to confirm you're not a bot.")).toBe("botcheck");
		expect(classifyFailure("sign in to confirm you are not a bot")).toBe("botcheck");
	});

	test("gate 2 - cipher extraction", () => {
		expect(
			classifyFailure(
				"dev.lavalink.youtube.cipher.ScriptExtractionException: Must find sig function from script: /s/player/8c3fda2d/player_embed.vflset/en_GB/base.js",
			),
		).toBe("cipher");
	});

	test("gate 4 - SABR / no plain-URL formats", () => {
		expect(classifyFailure("Could not find formats for the requested videoId.")).toBe("noformats");
		expect(classifyFailure("Client 'TVHTML5' is missing format URL for itag '251'. SABR?")).toBe(
			"noformats",
		);
	});

	test("gate 1 - client identity rejected", () => {
		expect(classifyFailure("The page needs to be reloaded.")).toBe("client");
		expect(classifyFailure("HTTP 400 FAILED_PRECONDITION")).toBe("client");
		expect(classifyFailure("AllClientsFailedException")).toBe("client");
	});

	test("messages seen live against a real node classify, not fall through", () => {
		// Both of these came back "unclassified" until a live probe caught them.
		expect(classifyFailure("This video cannot be loaded")).toBe("client");
		expect(classifyFailure("No formats found with the requested itag.")).toBe("noformats");
	});

	test("video genuinely unavailable", () => {
		expect(classifyFailure("This video requires login")).toBe("restricted");
		expect(classifyFailure("Video is age-restricted")).toBe("restricted");
	});

	test("unrecognised and empty input never throws", () => {
		expect(classifyFailure("something entirely new")).toBe("unknown");
		expect(classifyFailure(undefined)).toBe("unknown");
		expect(classifyFailure(null)).toBe("unknown");
		expect(classifyFailure("")).toBe("unknown");
	});

	test("bot check wins over the generic 'unavailable' pattern", () => {
		// A message can match several patterns; order must favour the specific gate.
		expect(classifyFailure("Sign in to confirm you're not a bot - video unavailable")).toBe(
			"botcheck",
		);
	});

	test("every kind has a gate label", () => {
		for (const kind of ["botcheck", "cipher", "noformats", "client", "restricted", "unknown"]) {
			expect(FAILURE_GATE[kind as keyof typeof FAILURE_GATE]).toBeTruthy();
		}
	});
});
