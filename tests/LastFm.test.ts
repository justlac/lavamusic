import { afterEach, describe, expect, test } from "bun:test";
import {
	calculateTagSimilarity,
	cleanArtistName,
	cleanTrackName,
	getSimilarTracks,
	mergeSeedCandidates,
	type SimilarCandidate,
} from "../src/utils/LastFm";

const realFetch = globalThis.fetch;
afterEach(() => {
	globalThis.fetch = realFetch;
});

function candidate(artist: string, title: string, match: number): SimilarCandidate {
	return { artist, title, query: `${artist} - ${title}`, match };
}

describe("cleanTrackName", () => {
	test("strips bracketed noise and feature credits", () => {
		expect(cleanTrackName("Despacito (Official Video)")).toBe("Despacito");
		expect(cleanTrackName("Song [Remastered]")).toBe("Song");
		expect(cleanTrackName("Track feat. Someone")).toBe("Track");
		expect(cleanTrackName("Track - Official Audio")).toBe("Track");
	});

	test("leaves a clean title untouched", () => {
		expect(cleanTrackName("Around the World")).toBe("Around the World");
	});
});

describe("cleanArtistName", () => {
	test("takes the first artist only", () => {
		expect(cleanArtistName("Daft Punk & Pharrell")).toBe("Daft Punk");
		expect(cleanArtistName("A, B, C")).toBe("A");
		expect(cleanArtistName("Architects")).toBe("Architects");
	});
});

describe("calculateTagSimilarity", () => {
	test("identical sets score 1", () => {
		expect(calculateTagSimilarity(["rock", "metal"], ["rock", "metal"])).toBe(1);
	});

	test("disjoint sets score 0", () => {
		expect(calculateTagSimilarity(["rock"], ["jazz"])).toBe(0);
	});

	test("partial overlap is Jaccard, and case-insensitive", () => {
		// {rock,metal} vs {ROCK,jazz} -> 1 shared / 3 union
		expect(calculateTagSimilarity(["rock", "metal"], ["ROCK", "jazz"])).toBeCloseTo(1 / 3);
	});

	test("empty input scores 0 rather than dividing by zero", () => {
		expect(calculateTagSimilarity([], ["rock"])).toBe(0);
		expect(calculateTagSimilarity([], [])).toBe(0);
	});
});

describe("mergeSeedCandidates", () => {
	test("agreement across seeds outranks a single high score", () => {
		const merged = mergeSeedCandidates([
			[candidate("A", "1", 0.9), candidate("B", "2", 0.5)],
			[candidate("B", "2", 0.5)],
		]);
		// B appears in two seeds, so it leads despite A's higher raw match.
		expect(merged[0].artist).toBe("B");
		expect(merged[1].artist).toBe("A");
	});

	test("later seeds are weighted down", () => {
		const merged = mergeSeedCandidates([
			[candidate("A", "1", 0.5)],
			[candidate("B", "2", 0.5)],
		]);
		// Same raw match, but seed 0 has weight 1 vs seed 1's 0.6.
		expect(merged[0].artist).toBe("A");
		expect(merged[0].match).toBeCloseTo(0.5);
		expect(merged[1].match).toBeCloseTo(0.3);
	});

	test("dedupes case-insensitively", () => {
		const merged = mergeSeedCandidates([
			[candidate("Daft Punk", "One More Time", 0.8)],
			[candidate("daft punk", "one more time", 0.8)],
		]);
		expect(merged).toHaveLength(1);
	});

	test("does not leak the internal seedCount field", () => {
		const merged = mergeSeedCandidates([[candidate("A", "1", 0.5)]]);
		expect(merged[0]).not.toHaveProperty("seedCount");
	});

	test("handles empty seeds", () => {
		expect(mergeSeedCandidates([])).toEqual([]);
		expect(mergeSeedCandidates([[], []])).toEqual([]);
	});
});

describe("getSimilarTracks", () => {
	const track = { info: { title: "Around the World", author: "Daft Punk" } };

	test("returns candidates sorted by match, descending", async () => {
		globalThis.fetch = (async () =>
			new Response(
				JSON.stringify({
					similartracks: {
						track: [
							{ name: "Low", artist: { name: "X" }, match: "0.2" },
							{ name: "High", artist: { name: "Y" }, match: "0.9" },
						],
					},
				}),
				{ status: 200 },
			)) as typeof fetch;

		const out = await getSimilarTracks(track, "key", 5);
		expect(out.map((c) => c.title)).toEqual(["High", "Low"]);
		expect(out[0].match).toBeCloseTo(0.9);
	});

	test("a network failure yields [] instead of throwing", async () => {
		globalThis.fetch = (async () => {
			throw new Error("boom");
		}) as typeof fetch;
		// Distinct title so the module-level cache cannot answer this.
		expect(
			await getSimilarTracks({ info: { title: "Network Fail Probe", author: "Nobody" } }, "key"),
		).toEqual([]);
	});

	test("an API-level error yields [] instead of throwing", async () => {
		globalThis.fetch = (async () =>
			new Response(JSON.stringify({ error: 6, message: "Track not found" }), {
				status: 200,
			})) as typeof fetch;
		expect(
			await getSimilarTracks({ info: { title: "Api Error Probe", author: "Nobody" } }, "key"),
		).toEqual([]);
	});

	test("a missing api key short-circuits without calling fetch", async () => {
		let called = false;
		globalThis.fetch = (async () => {
			called = true;
			return new Response("{}", { status: 200 });
		}) as typeof fetch;
		expect(await getSimilarTracks(track, "")).toEqual([]);
		expect(called).toBe(false);
	});

	test("results are cached - a second call does not hit the network", async () => {
		let calls = 0;
		globalThis.fetch = (async () => {
			calls++;
			return new Response(
				JSON.stringify({
					similartracks: { track: [{ name: "T", artist: { name: "A" }, match: "0.5" }] },
				}),
				{ status: 200 },
			);
		}) as typeof fetch;

		const seed = { info: { title: "Cache Probe", author: "Cache Artist" } };
		await getSimilarTracks(seed, "key", 7);
		await getSimilarTracks(seed, "key", 7);
		expect(calls).toBe(1);
	});
});
