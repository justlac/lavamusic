import { describe, expect, test } from "bun:test";
import { ALWAYS_PREFIX, buildPrefixRegex, escapeRegex } from "../src/utils/Prefix";

const BOT_ID = "123456789012345678";

/**
 * This regex runs against every message in every guild, so both failure modes
 * are covered here: too loose (ordinary chat becomes commands) and too strict
 * (every command breaks at once).
 */
function invoked(content: string, guildPrefix = "!"): string | null {
	const re = buildPrefixRegex(BOT_ID, guildPrefix);
	const match = content.match(re);
	if (!match) return null;
	// Mirrors MessageCreate: slice the prefix, trim, take the first word.
	const args = content.slice(match[0].length).trim().split(/ +/g);
	return args.shift()?.toLowerCase() || null;
}

describe("buildPrefixRegex", () => {
	test("the configured guild prefix still works", () => {
		expect(invoked("!play song")).toBe("play");
		expect(invoked("!ytdiag")).toBe("ytdiag");
	});

	test("whitespace after the configured prefix is still allowed", () => {
		expect(invoked("! play song")).toBe("play");
	});

	test("a bot mention still works", () => {
		expect(invoked(`<@${BOT_ID}> play`)).toBe("play");
		expect(invoked(`<@!${BOT_ID}> play`)).toBe("play");
	});

	test("`-` is accepted regardless of the guild prefix", () => {
		expect(invoked("-ytdiag")).toBe("ytdiag");
		expect(invoked("-play song")).toBe("play");
		expect(invoked("-ytdiag", "?")).toBe("ytdiag");
	});

	test("a custom guild prefix does not disable `-`", () => {
		expect(invoked("?play", "?")).toBe("play");
		expect(invoked("-play", "?")).toBe("play");
	});

	test("`- ` does NOT invoke a command - markdown lists must stay inert", () => {
		// The critical case: without the lookahead, the trim() in MessageCreate
		// would turn a bulleted list into command invocations.
		expect(invoked("- play some music later")).toBeNull();
		expect(invoked("- buy milk\n- walk dog")).toBeNull();
		expect(invoked("-   skip")).toBeNull();
	});

	test("ordinary prose and dashes are ignored", () => {
		expect(invoked("hello there")).toBeNull();
		expect(invoked("well - maybe")).toBeNull();
		expect(invoked("")).toBeNull();
	});

	test("negative numbers and em-dash-ish text do not crash", () => {
		// These DO match `-` and are then looked up as commands; MessageCreate
		// bails on an unknown command, so the only requirement is no throw.
		expect(() => invoked("-1")).not.toThrow();
		expect(invoked("-1")).toBe("1");
	});

	test("a regex-special guild prefix is escaped, not interpreted", () => {
		expect(invoked("+play", "+")).toBe("play");
		expect(invoked("$play", "$")).toBe("play");
		expect(invoked("(play", "(")).toBe("play");
		// "." must not behave as "any character"
		expect(invoked(".play", ".")).toBe("play");
		expect(invoked("xplay", ".")).toBeNull();
	});

	test("a guild prefix of `-` does not double-match or break", () => {
		expect(invoked("-play", "-")).toBe("play");
		expect(invoked("-ytdiag", "-")).toBe("ytdiag");
	});

	test("`- ` stays inert even when the guild prefix IS `-`", () => {
		// Regression: the configured-prefix branch allows trailing whitespace,
		// so a guild whose prefix is itself `-` bypassed the lookahead and
		// turned every markdown list into command invocations. `-` is now the
		// default PREFIX, so this is the common case, not an edge case.
		expect(invoked("- play some music later", "-")).toBeNull();
		expect(invoked("- shuffle the deck", "-")).toBeNull();
		expect(invoked("- buy milk\n- walk dog", "-")).toBeNull();
		expect(invoked("-   skip", "-")).toBeNull();
	});

	test("escapeRegex escapes the characters that matter", () => {
		expect(escapeRegex(".")).toBe("\\.");
		expect(escapeRegex("$")).toBe("\\$");
		expect(escapeRegex("a")).toBe("a");
	});

	test("ALWAYS_PREFIX is the documented dash", () => {
		expect(ALWAYS_PREFIX).toBe("-");
	});
});
