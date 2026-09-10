/**
 * Test preload. `src/env.ts` validates process.env with zod at import time, so
 * the required variables must exist before any module under test is loaded.
 * These are placeholders - nothing in the test suite makes a real connection.
 */
process.env.TOKEN ??= "test-token";
process.env.CLIENT_ID ??= "000000000000000000";
process.env.OWNER_IDS ??= '["000000000000000000"]';
process.env.NODES ??= JSON.stringify([
	{ id: "test", host: "127.0.0.1", port: 2333, authorization: "youshallnotpass" },
]);
process.env.LASTFM_API_KEY ??= "test-lastfm-key";
process.env.GENIUS_API ??= "test-genius-key";
