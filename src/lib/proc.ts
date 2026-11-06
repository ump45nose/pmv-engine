import path from "node:path";

async function forward(stream: ReadableStream<Uint8Array>): Promise<string> {
  const decoder = new TextDecoder();
  let text = "";
  for await (const chunk of stream) {
    process.stderr.write(chunk);
    text += decoder.decode(chunk, { stream: true });
  }
  return text;
}

/**
 * Run a command whose output streams to our stderr, keeping stdout free for the CLI's JSON.
 * With `captureStdout` the child's stdout is returned instead of streamed. Throws on a non-zero exit.
 */
export async function run(
  cmd: string[],
  options: { cwd: string; env?: Record<string, string | undefined>; captureStdout?: boolean },
): Promise<string> {
  const proc = Bun.spawn(cmd, { cwd: options.cwd, env: options.env, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([
    options.captureStdout ? new Response(proc.stdout).text() : forward(proc.stdout),
    forward(proc.stderr),
    proc.exited,
  ]);
  if (code !== 0) {
    const tail = stderr.trim().split("\n").slice(-3).join(" | ");
    throw new Error(`${path.basename(cmd[0]!)} ${cmd.slice(1, 5).join(" ")} exited with code ${code}: ${tail}`);
  }
  return stdout;
}
