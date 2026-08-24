import { promises as fs } from "fs";
import { readdir } from "fs/promises";
import { join, relative, extname } from "path";

const SECRET_FILE_PATTERNS = [
	/^\.env(\..*)?$/,
	/\.pem$/,
	/\.key$/,
	/^id_rsa/,
	/\.p12$/,
	/\.pfx$/,
	/credentials\.json$/i,
];

export const isSecretFile = (name: string): boolean =>
	SECRET_FILE_PATTERNS.some((p) => p.test(name));

const EXCLUDED_DIRS = new Set([
	"node_modules",
	".git",
	"dist",
	".next",
	"build",
	"out",
	".turbo",
	".cache",
	"coverage",
	"target",
	"vendor",
]);

const EXCLUDED_FILES = new Set([
	"package-lock.json",
	"bun.lockb",
	"bun.lock",
	"yarn.lock",
	"pnpm-lock.yaml",
	".DS_Store",
]);

const EXCLUDED_EXTENSIONS = new Set([
	".png",
	".jpg",
	".jpeg",
	".gif",
	".svg",
	".webp",
	".ico",
	".bmp",
	".tiff",
	".mp4",
	".mov",
	".avi",
	".mp3",
	".wav",
	".ogg",
	".webm",
	".woff",
	".woff2",
	".ttf",
	".otf",
	".eot",
	".zip",
	".tar",
	".gz",
	".rar",
	".7z",
	".exe",
	".dll",
	".so",
	".dylib",
	".wasm",
	".node",
	".pdf",
	".docx",
	".xlsx",
	".sqlite",
	".db",
]);

const MAX_FILE_SIZE = 500 * 1024;

export const writeToFile = async (
	filePath: string,
	content: string,
): Promise<void> => {
	try {
		await fs.writeFile(filePath, content, "utf-8");
	} catch (error) {
		console.error(`Failed to write to ${filePath}:`, error);
		throw error;
	}
};

export const readFromFile = async (filePath: string): Promise<string> => {
	try {
		return await fs.readFile(filePath, "utf-8");
	} catch (error) {
		console.error(`Failed to read from ${filePath}:`, error);
		throw error;
	}
};

export const scanRepository = async (
	dir: string,
	baseDir: string = dir,
): Promise<Array<{ path: string; content: string }>> => {
	const entries = await readdir(dir, { withFileTypes: true });
	let results: Array<{ path: string; content: string }> = [];

	for (const entry of entries) {
		const fullPath = join(dir, entry.name);

		if (entry.isDirectory()) {
			if (
				EXCLUDED_DIRS.has(entry.name) ||
				entry.name.startsWith(".") ||
				isSecretFile(entry.name)
			)
				continue;
			const subFiles = await scanRepository(fullPath, baseDir);
			results.push(...subFiles);
			continue;
		}

		if (!entry.isFile()) continue;
		if (EXCLUDED_FILES.has(entry.name)) continue;

		const ext = extname(entry.name).toLowerCase();
		if (EXCLUDED_EXTENSIONS.has(ext)) continue;

		try {
			const file = Bun.file(fullPath);
			if (file.size > MAX_FILE_SIZE) continue;

			const content = await file.text();

			// Cheap binary sniff: text files shouldn't contain null bytes
			if (content.includes("\u0000")) continue;

			results.push({
				path: relative(baseDir, fullPath),
				content,
			});
		} catch (e) {
			// Handle specific file read errors if needed
			console.error(`Failed to read file ${fullPath}:`, e);
		}
	}

	return results;
};

export type RepoEntry =
	| { path: string; type: "file" }
	| { path: string; type: "directory"; children: RepoEntry[] };

export const scanRepositoryNames = async (
	dir: string,
	baseDir: string = dir,
): Promise<RepoEntry[]> => {
	const entries = await readdir(dir, { withFileTypes: true });
	let results: RepoEntry[] = [];

	for (const entry of entries) {
		const fullPath = join(dir, entry.name);

		if (entry.isDirectory()) {
			if (
				EXCLUDED_DIRS.has(entry.name) ||
				entry.name.startsWith(".") ||
				isSecretFile(entry.name)
			)
				continue;
			const children = await scanRepositoryNames(fullPath, baseDir);
			results.push({
				path: relative(baseDir, fullPath),
				type: "directory",
				children,
			});
			continue;
		}

		if (!entry.isFile()) continue;
		if (EXCLUDED_FILES.has(entry.name)) continue;

		const ext = extname(entry.name).toLowerCase();
		if (EXCLUDED_EXTENSIONS.has(ext)) continue;

		results.push({
			path: relative(baseDir, fullPath),
			type: "file",
		});
	}

	return results;
};

// 6. Append content to a file — creates it if it doesn't exist yet,
// otherwise appends. If you need "must already exist" semantics, check
// file.exists() before calling this.
export const appendFileContent = async (
	filePath: string,
	content: string,
): Promise<void> => {
	const file = Bun.file(filePath);
	const existing = (await file.exists()) ? await file.text() : "";
	await Bun.write(filePath, existing + content);
};

export const readFileContent = async (filePath: string): Promise<string> => {
	const file = Bun.file(filePath);
	if (!(await file.exists())) {
		throw new Error(`File not found: ${filePath}`);
	}
	return await file.text();
};

// 4. Edit/Update a file by replacing specific strings or lines
// NOTE: remember to extend this function to allow multi target edits
export const editFileContent = async (
	filePath: string,
	target: string,
	replacement: string,
): Promise<void> => {
	const file = Bun.file(filePath);
	if (!(await file.exists())) {
		throw new Error(`File not found: ${filePath}`);
	}
	const content = await file.text();

	// Count occurrences instead of a single includes() check — a plain
	// includes() only tells you it's *present*, not that it's unique.
	// String#replace only ever touches the first match, so if target
	// appears more than once, you'd silently edit the wrong occurrence
	// with no error surfaced.
	const occurrences = content.split(target).length - 1;
	if (occurrences === 0) {
		throw new Error(`Target string not found in ${filePath}`);
	}
	if (occurrences > 1) {
		throw new Error(
			`Target string is not unique in ${filePath} (found ${occurrences} occurrences). ` +
			`Include more surrounding context in "target" so it matches exactly one location.`,
		);
	}

	const updatedContent = content.replace(target, replacement);
	await Bun.write(filePath, updatedContent);
};

// 5. Write a new file — fails if the path already exists, to avoid
// silently clobbering something. Use writeFileContent(..., { overwrite: true })
// if you explicitly want to replace an existing file.
export const writeFileContent = async (
	filePath: string,
	content: string,
	options: { overwrite?: boolean } = {},
): Promise<void> => {
	const file = Bun.file(filePath);
	if (!options.overwrite && (await file.exists())) {
		throw new Error(
			`File already exists: ${filePath}. Pass { overwrite: true } to replace it.`,
		);
	}
	await Bun.write(filePath, content);
};

export interface SearchResult {
	path: string;
	type: "file" | "directory";
}

export interface SearchOptions {
	caseSensitive?: boolean;
	matchType?: "exact" | "partial";
}

export const searchRepository = async (
	dir: string,
	query: string,
	options: SearchOptions & { baseDir?: string } = {},
): Promise<SearchResult[]> => {
	const {
		caseSensitive = false,
		matchType = "partial",
		baseDir = dir,
	} = options;
	const normalizedQuery = caseSensitive ? query : query.toLowerCase();

	const matches = (name: string): boolean => {
		const normalizedName = caseSensitive ? name : name.toLowerCase();
		return matchType === "exact"
			? normalizedName === normalizedQuery
			: normalizedName.includes(normalizedQuery);
	};

	const entries = await readdir(dir, { withFileTypes: true });
	let results: SearchResult[] = [];

	for (const entry of entries) {
		const fullPath = join(dir, entry.name);
		const relPath = relative(baseDir, fullPath);

		if (entry.isDirectory()) {
			if (
				EXCLUDED_DIRS.has(entry.name) ||
				entry.name.startsWith(".") ||
				isSecretFile(entry.name)
			)
				continue;

			if (matches(entry.name)) {
				results.push({ path: relPath, type: "directory" });
			}

			const subResults = await searchRepository(fullPath, query, {
				...options,
				baseDir,
			});
			results.push(...subResults);
			continue;
		}

		if (!entry.isFile()) continue;
		if (EXCLUDED_FILES.has(entry.name)) continue;

		const ext = extname(entry.name).toLowerCase();
		if (EXCLUDED_EXTENSIONS.has(ext)) continue;

		if (matches(entry.name)) {
			results.push({ path: relPath, type: "file" });
		}
	}

	return results;
};
