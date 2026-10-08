import { main } from "./cli";
import { installCrashReporter } from "./beta";

installCrashReporter();
const exitCode = await main();
if (exitCode !== 0) process.exitCode = exitCode;
