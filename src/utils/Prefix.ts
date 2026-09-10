/**
 * Prefix matching for message (non-slash) commands.
 *
 * Extracted from the MessageCreate handler because it runs against every
 * message in every guild: a regex that is too loose silently turns ordinary
 * chat into command invocations, and one that is too strict breaks every
 * command at once. Both failure modes are worth a test.
 */

/**
 * Always accepted in addition to the guild's configured prefix, so owner-only
 * tools have a predictable invocation that does not depend on per-guild config.
 */
export const ALWAYS_PREFIX = "-";

/** Escapes a user-supplied prefix for safe use inside a RegExp. */
export function escapeRegex(str: string): string {
	return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Builds the prefix matcher for one guild.
 *
 * Accepts, in order:
 *   - a bot mention, optionally followed by whitespace
 *   - the guild's configured prefix, optionally followed by whitespace
 *   - `-`, with NO whitespace after it
 *
 * That last restriction matters: markdown lists start lines with "- ", so
 * allowing whitespace would make "- play some music" invoke `play`. Requiring
 * the command to be flush against the dash keeps `-ytdiag` working while
 * leaving normal prose alone. (The caller trims after slicing off the prefix,
 * so a lookahead is the only thing that can enforce this.)
 */
export function buildPrefixRegex(botId: string | undefined, guildPrefix: string): RegExp {
	const mention = `<@!?${botId}>`;
	const configured = escapeRegex(guildPrefix);
	const always = escapeRegex(ALWAYS_PREFIX);
	return new RegExp(`^(?:(?:${mention}|${configured})\\s*|${always}(?!\\s))`);
}
