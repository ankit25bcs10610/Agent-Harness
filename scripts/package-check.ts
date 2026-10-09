import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const temporary = await mkdtemp(join(tmpdir(), "chiku-package-check-"));
try {
  const result = Bun.spawn(["npm", "pack", "--dry-run"], {
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      npm_config_cache: join(temporary, "npm-cache"),
      npm_config_update_notifier: "false",
      npm_config_audit: "false",
      npm_config_fund: "false",
    },
  });
  const [code, stdout, stderr] = await Promise.all([
    result.exited,
    new Response(result.stdout).text(),
    new Response(result.stderr).text(),
  ]);
  if (code !== 0) {
    console.error(stderr || stdout);
    process.exitCode = code;
  } else {
    process.stdout.write(stdout);
  }
} finally {
  await rm(temporary, { recursive: true, force: true });
}
