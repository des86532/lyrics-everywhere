import { startCompanion } from "./runtime.js";

async function main(): Promise<void> {
  console.log("=========================================");
  console.log("  Universal Sing-Along Companion        ");
  console.log("=========================================");
  const runtime = await startCompanion({ args: process.argv.slice(2) });
  let stopping = false;
  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    await runtime.stop();
  };
  process.once("SIGINT", () => { void shutdown(); });
  process.once("SIGTERM", () => { void shutdown(); });
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
