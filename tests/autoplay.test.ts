import { afterEach, describe, expect, test } from "bun:test";
import { autoPlayFunction, autoplayNote } from "../src/utils/functions/player";

/**
 * These exercise autoPlayFunction end to end with a fake player and a stubbed
 * `fetch`, so the real Last.fm parsing, seed merging, ranking, dedupe, LRU and
 * in-flight guard all run - only the network and Lavalink are faked.
 */

const realFetch = globalThis.fetch;
afterEach(() => {
	globalThis.fetch = realFetch;
});

type FakeTrack = {
	info: { title: string; author: string; identifier: string };
	pluginInfo: { clientData?: Record<string, unknown> };
	requester?: unknown;
};

function makeTrack(title: string, author = "Seed Artist"): FakeTrack {
	return {
		info: { title, author, identifier: `${author}-${title}` },
		pluginInfo: {},
		requester: { id: "1", username: "tester" },
	};
}

/** Minimal stand-in for the bits of Player that autoPlayFunction touches. */
function makePlayer(opts: { previous?: FakeTrack[] } = {}) {
	const data = new Map<string, unknown>([["autoplay", true]]);
	const added: FakeTrack[] = [];
	const searches: string[] = [];

	const player = {
		guildId: "guild-1",
		get: <T>(k: string): T => data.get(k) as T,
		set: (k: string, v: unknown) => data.set(k, v),
		queue: {
			current: null as FakeTrack | null,
			tracks: [] as FakeTrack[],
			previous: opts.previous ?? [],
			add: async (t: FakeTrack | FakeTrack[]) => {
				for (const x of Array.isArray(t) ? t : [t]) added.push(x);
			},
		},
		search: async ({ query }: { query: string }) => {
			searches.push(query);
			const [author, title] = query.split(" - ");
			return { tracks: [makeTrack(title ?? query, author ?? "A")] };
		},
	};

	// biome-ignore lint/suspicious/noExplicitAny: deliberately partial Player stub
	return { player: player as any, added, searches, data };
}

/** Canned Last.fm track.getsimilar response. */
function stubLastFm(names: Array<[string, string, string]>, onCall?: () => void) {
	globalThis.fetch = (async () => {
		onCall?.();
		return new Response(
			JSON.stringify({
				similartracks: {
					track: names.map(([artist, name, match]) => ({ name, artist: { name: artist }, match })),
				},
			}),
			{ status: 200 },
		);
	}) as typeof fetch;
}

describe("autoPlayFunction", () => {
	test("queues up to MAX_TRACKS and stamps autoplay metadata", async () => {
		stubLastFm([
			["A1", "T1", "0.9"],
			["A2", "T2", "0.8"],
			["A3", "T3", "0.7"],
			["A4", "T4", "0.6"],
			["A5", "T5", "0.5"],
			["A6", "T6", "0.4"],
			["A7", "T7", "0.3"],
		]);
		const { player, added } = makePlayer();
		await autoPlayFunction(player, makeTrack("Metadata Seed") as never);

		expect(added).toHaveLength(5); // MAX_TRACKS
		for (const track of added) {
			expect(track.pluginInfo.clientData?.fromAutoplay).toBe(true);
			expect(track.pluginInfo.clientData?.autoplaySeed).toBe("Seed Artist - Metadata Seed");
		}
	});

	test("does nothing when autoplay is disabled", async () => {
		stubLastFm([["A", "T", "0.9"]]);
		const { player, added, data } = makePlayer();
		data.set("autoplay", false);
		await autoPlayFunction(player, makeTrack("Disabled Seed") as never);
		expect(added).toHaveLength(0);
	});

	test("does nothing without a last track", async () => {
		const { player, added } = makePlayer();
		await autoPlayFunction(player, undefined);
		expect(added).toHaveLength(0);
	});

	test("concurrent runs are guarded - the second is a no-op", async () => {
		let lastfmCalls = 0;
		stubLastFm([["A1", "T1", "0.9"]], () => {
			lastfmCalls++;
		});
		const { player, added } = makePlayer();

		const seed = makeTrack("Concurrency Seed") as never;
		await Promise.all([autoPlayFunction(player, seed), autoPlayFunction(player, seed)]);

		// One run's worth of work, not two.
		expect(lastfmCalls).toBe(1);
		expect(added).toHaveLength(1);
	});

	test("the in-flight guard is released, so a later run still works", async () => {
		const { player, added } = makePlayer();

		stubLastFm([["Release A", "First", "0.9"]]);
		await autoPlayFunction(player, makeTrack("Release Seed A") as never);
		expect(added).toHaveLength(1);
		expect(player.get("autoplayInFlight")).toBe(false);

		// Different candidates, so the dedupe history cannot mask a stuck guard.
		stubLastFm([["Release B", "Second", "0.9"]]);
		await autoPlayFunction(player, makeTrack("Release Seed B") as never);
		expect(added.map((t) => t.info.title)).toEqual(["First", "Second"]);
	});

	test("repeat queries are served from the search cache", async () => {
		stubLastFm([["Cached Artist", "Cached Title", "0.9"]]);

		// First player warms the cache.
		const first = makePlayer();
		await autoPlayFunction(first.player, makeTrack("Cache Seed One") as never);
		expect(first.searches).toEqual(["Cached Artist - Cached Title"]);

		// A different player has its own dedupe history but shares the module
		// cache, so the same query must not reach Lavalink again.
		const second = makePlayer();
		await autoPlayFunction(second.player, makeTrack("Cache Seed Two") as never);
		expect(second.searches).toEqual([]);
		expect(second.added).toHaveLength(1);
	});

	test("cache hits are copies - callers cannot corrupt the cached entry", async () => {
		stubLastFm([["Clone Artist", "Clone Title", "0.9"]]);

		const first = makePlayer();
		await autoPlayFunction(first.player, makeTrack("Clone Seed One") as never);
		const second = makePlayer();
		await autoPlayFunction(second.player, makeTrack("Clone Seed Two") as never);

		expect(first.added[0]).not.toBe(second.added[0]);
		// Each run stamps its own seed, which proves the objects are distinct.
		expect(first.added[0].pluginInfo.clientData?.autoplaySeed).toBe("Seed Artist - Clone Seed One");
		expect(second.added[0].pluginInfo.clientData?.autoplaySeed).toBe("Seed Artist - Clone Seed Two");
	});

	test("tracks already in the queue are not queued again", async () => {
		stubLastFm([
			["Dup Artist", "Dup Title", "0.9"],
			["New Artist", "New Title", "0.8"],
		]);
		const { player, added } = makePlayer();
		player.queue.tracks = [makeTrack("Dup Title", "Dup Artist")];

		await autoPlayFunction(player, makeTrack("Dedupe Seed") as never);
		expect(added.map((t) => t.info.title)).toEqual(["New Title"]);
	});

	test("seeds from several recent tracks, not just the last one", async () => {
		const seenSeeds: string[] = [];
		globalThis.fetch = (async (url: string) => {
			seenSeeds.push(new URL(url).searchParams.get("track") ?? "");
			return new Response(
				JSON.stringify({
					similartracks: { track: [{ name: "X", artist: { name: "Y" }, match: "0.5" }] },
				}),
				{ status: 200 },
			);
		}) as unknown as typeof fetch;

		const { player } = makePlayer({
			previous: [makeTrack("Older Seed"), makeTrack("Recent Seed")],
		});
		await autoPlayFunction(player, makeTrack("Newest Seed") as never);

		// Newest first, then most-recent previous - capped at SEED_COUNT = 3.
		expect(seenSeeds).toEqual(["Newest Seed", "Recent Seed", "Older Seed"]);
	});

	test("a Last.fm outage degrades quietly instead of throwing", async () => {
		globalThis.fetch = (async () => {
			throw new Error("network down");
		}) as typeof fetch;
		const { player, added } = makePlayer();
		await expect(
			autoPlayFunction(player, makeTrack("Outage Seed") as never),
		).resolves.toBeUndefined();
		expect(added).toHaveLength(0);
		expect(player.get("autoplayInFlight")).toBe(false);
	});
});

describe("autoplayNote", () => {
	test("returns empty string for a user-requested track", () => {
		const track = makeTrack("Requested");
		// biome-ignore lint/suspicious/noExplicitAny: partial Track stub
		expect(autoplayNote(track as any)).toBe("");
	});

	test("returns empty string when pluginInfo is absent entirely", () => {
		// biome-ignore lint/suspicious/noExplicitAny: partial Track stub
		expect(autoplayNote({ info: { title: "x" } } as any)).toBe("");
	});
});
