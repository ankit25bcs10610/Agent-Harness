import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const temporary = await mkdtemp(join(tmpdir(), "chiku-package-smoke-"));
const npmEnvironment = {
  ...process.env,
  npm_config_cache: join(temporary, "npm-cache"),
  npm_config_update_notifier: "false",
};
try {
  const pack = Bun.spawn(
    ["npm", "pack", "--json", "--pack-destination", temporary],
    {
      stdout: "pipe",
      stderr: "pipe",
      env: npmEnvironment,
    },
  );
  const [packCode, packOutput] = await Promise.all([
    pack.exited,
    new Response(pack.stdout).text(),
  ]);
  if (packCode !== 0) throw new Error(`npm pack failed: ${packOutput}`);
  const metadata = JSON.parse(packOutput) as Array<{ filename: string }>;
  const archive = join(temporary, metadata[0]?.filename ?? "");
  if (!archive) throw new Error("npm pack did not produce an archive");
  const install = Bun.spawn(
    [
      "npm",
      "install",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      "--prefix",
      temporary,
      archive,
    ],
    {
      stdout: "pipe",
      stderr: "pipe",
      env: npmEnvironment,
    },
  );
  const [installCode, installOutput] = await Promise.all([
    install.exited,
    new Response(install.stderr).text(),
  ]);
  if (installCode !== 0)
    throw new Error(`npm install failed: ${installOutput}`);
  const executable = join(
    temporary,
    "node_modules",
    ".bin",
    process.platform === "win32" ? "chiku.cmd" : "chiku",
  );
  for (const args of [["--help"], ["--version"]]) {
    const command =
      process.platform === "win32"
        ? ["cmd.exe", "/d", "/s", "/c", executable, ...args]
        : ["bun", executable, ...args];
    const smoke = Bun.spawn(command, {
      stdout: "pipe",
      stderr: "pipe",
    });
    const [code, output, error] = await Promise.all([
      smoke.exited,
      new Response(smoke.stdout).text(),
      new Response(smoke.stderr).text(),
    ]);
    if (code !== 0 || !output.trim())
      throw new Error(`packaged CLI failed for ${args.join(" ")}: ${error}`);
  }
} finally {
  await rm(temporary, { recursive: true, force: true });
}
