// shellHandler.ts

export interface ShellCommandResult {
	stdout: string;
	stderr: string;
	exitCode: number;
	success: boolean;
	command: string;
	durationMs: number;
	timedOut: boolean;
}

export interface ShellCommandOptions {
	cwd?: string;
	/** Kill the process if it runs past this — prevents a hung command
	 * (e.g. something waiting on stdin, or an accidental `tail -f`) from
	 * blocking the whole agent loop forever. Default 30s. */
	timeoutMs?: number;
	env?: Record<string, string>;
	/** Cap each stream's captured output so a runaway command (e.g. `find /`,
	 * `cat` on a huge file) can't blow up memory or flood the model's
	 * context window later. Default ~200KB. */
	maxOutputChars?: number;
}

/**
 * Runs a shell command via bash -lc, capturing stdout/stderr/exit code
 * separately rather than letting anything print directly. Never throws for
 * a non-zero exit — check `.success`/`.exitCode` yourself; this only
 * throws if spawning itself fails (e.g. bash not found).
 */
export async function runShellCommand(
	command: string,
	options: ShellCommandOptions = {},
): Promise<ShellCommandResult> {
	const {
		cwd = process.cwd(),
		timeoutMs = 30_000,
		env,
		maxOutputChars = 200_000,
	} = options;

	const start = performance.now();
	const proc = Bun.spawn({
		cmd: ["bash", "-lc", command],
		cwd,
		env: env ? { ...process.env, ...env } : process.env,
		stdout: "pipe",
		stderr: "pipe",
	});

	let timedOut = false;
	const timeout = setTimeout(() => {
		timedOut = true;
		proc.kill();
	}, timeoutMs);

	const [stdoutBuf, stderrBuf, exitCode] = await Promise.all([
		new Response(proc.stdout).arrayBuffer(),
		new Response(proc.stderr).arrayBuffer(),
		proc.exited,
	]);
	clearTimeout(timeout);

	const truncate = (buf: ArrayBuffer): string => {
		const text = Buffer.from(buf).toString("utf-8");
		return text.length > maxOutputChars
			? `${text.slice(0, maxOutputChars)}\n...[truncated, ${text.length - maxOutputChars} more chars]`
			: text;
	};

	return {
		stdout: truncate(stdoutBuf),
		stderr: truncate(stderrBuf),
		exitCode,
		success: !timedOut && exitCode === 0,
		command,
		durationMs: Math.round(performance.now() - start),
		timedOut,
	};
}
