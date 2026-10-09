import { render } from "ink";
import { App } from "./ui/App";
import { generateSystemPrompt } from "./context/system_prompt";
import { createSession, loadLatestSession } from "./session/store";
import { getContextWindow } from "./provider/model";
import { CONFIG } from "./config";
import type { CliOptions } from "./cli";
import {
  getInstallationId,
  loadAnalyticsConsent,
  recordAnalyticsEvent,
} from "./analytics";

export async function launch(
  options: Pick<CliOptions, "continueSession" | "model">,
) {
  const analyticsDirectory = `${process.cwd()}/.chiku/analytics`;
  if ((await loadAnalyticsConsent(analyticsDirectory)).analyticsOptIn) {
    const installationId = await getInstallationId(analyticsDirectory);
    await recordAnalyticsEvent(analyticsDirectory, {
      name: "first_launch",
      installationId,
      productVersion: process.env.CHIKU_VERSION ?? "source",
      properties: { mode: "local" },
    });
  }
  const loopModel =
    options.model ?? process.env.CHIKU_MODEL ?? CONFIG.loopModel;
  const workflow = CONFIG.workflow
    ? {
        root: process.cwd(),
        plannedFiles: CONFIG.workflow.plannedFiles ?? [],
        maxRepairAttempts: CONFIG.workflow.maxRepairAttempts ?? 0,
        commandTimeoutMs: CONFIG.workflow.commandTimeoutMs ?? 120_000,
        maxOutputChars: CONFIG.workflow.maxOutputChars ?? 20_000,
        enabled: CONFIG.workflow.enabled ?? true,
      }
    : undefined;
  const config = {
    ...CONFIG,
    loopModel,
    ...(workflow ? { workflow } : {}),
    contextWindow: await getContextWindow(loopModel, CONFIG.contextWindow),
  };
  const systemPrompt = await generateSystemPrompt();
  const loaded = options.continueSession
    ? await loadLatestSession()
    : undefined;
  if (options.continueSession && !loaded)
    console.log("no saved session found, starting fresh session");
  else if (loaded) console.log(`resuming session: ${loaded.id}`);
  const session = loaded ?? createSession("");
  render(
    <App systemPrompt={systemPrompt} session={session} config={config} />,
    {
      exitOnCtrlC: false,
    },
  );
}
