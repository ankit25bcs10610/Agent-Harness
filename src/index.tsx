import { main } from "./cli";

const exitCode = await main();
if (exitCode !== 0) process.exitCode = exitCode;
