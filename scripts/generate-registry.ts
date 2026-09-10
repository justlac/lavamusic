import { existsSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, parse, relative } from "node:path";

const SRC_DIR = join(process.cwd(), "src");

const REGISTRY_CONFIG = {
	commands: {
		path: join(SRC_DIR, "commands"),
		exportName: "CommandList",
	},
	events: {
		path: join(SRC_DIR, "events"),
		exportName: "EventList",
	},
	components: {
		path: join(SRC_DIR, "components"),
		exportName: "ComponentList",
	},
} as const;

type RegistryType = keyof typeof REGISTRY_CONFIG;

/**
 * Files to explicitly ignore during the scan.
 */
const IGNORED_EXTENSIONS = [".d.ts", ".test.ts", ".spec.ts", ".map"];
const IGNORED_FILES = ["index.ts"];

function generateIndex(type: RegistryType) {
	const config = REGISTRY_CONFIG[type];
	const dir = config.path;
	const files: string[] = [];

	if (!existsSync(dir)) {
		console.warn(`⚠️ Directory not found: ${dir}. Skipping registry generation.`);
		return;
	}

	function scan(directory: string) {
		const entries = readdirSync(directory);
		for (const entry of entries) {
			const fullPath = join(directory, entry);

			if (statSync(fullPath).isDirectory()) {
				scan(fullPath);
				continue;
			}

			if (!entry.endsWith(".ts")) continue;
			if (IGNORED_FILES.includes(entry)) continue;
			if (IGNORED_EXTENSIONS.some((ext) => entry.endsWith(ext))) continue;

			files.push(fullPath);
		}
	}

	scan(dir);
	files.sort(); // Sort files for deterministic output

	const imports: string[] = [];
	const exports: string[] = [];
	const usedNames = new Set<string>();

	files.forEach((file, _index) => {
		// Generate clean variable name
		let varName = parse(file).name;
		// Remove non-alphanumeric chars (Var-Name -> VarName)
		varName = varName.replace(/[^a-zA-Z0-9]/g, "");
		// Ensure it doesn't start with a number (247 -> _247)
		if (/^[0-9]/.test(varName)) varName = `_${varName}`;

		// Handle name collisions
		let finalName = varName;
		let counter = 1;
		while (usedNames.has(finalName)) {
			finalName = `${varName}${counter}`;
			counter++;
		}
		usedNames.add(finalName);

		/**
		 * Normalize path for import (force POSIX style /)
		 * On Windows 'path.relative' returns backslashes, imports require slashes
		 */
		const importPath = `./${relative(dir, file).replace(/\\/g, "/").replace(/\.ts$/, "")}`;

		imports.push(`import ${finalName} from "${importPath}";`);
		exports.push(finalName);
	});

	const content = [
		"// AUTO-GENERATED FILE. DO NOT EDIT MANUALLY.",
		"// Run: bun run scripts/generate-registry.ts",
		"// biome-ignore-all lint: generated file",
		"",
		imports.join("\n"),
		"",
		`export const ${config.exportName} = [`,
		// Trailing comma so the generated file matches biome's formatter and
		// `biome check src/` stays clean without an ignore.
		`${exports.map((name) => `\t${name},`).join("\n")}`,
		"];",
		"",
	].join("\n");

	writeFileSync(join(dir, "index.ts"), content);
	console.log(`✅ Generated ${type} registry with ${files.length} entries.`);
}

console.log("🟢 Starting Registry Generation...");
const start = performance.now();

for (const type of Object.keys(REGISTRY_CONFIG) as RegistryType[]) {
	generateIndex(type);
}

const end = performance.now();
console.log(`✨ Done in ${(end - start).toFixed(2)}ms`);
