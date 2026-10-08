// OpenRouter config

import dotenv from "dotenv";
import { OpenRouter } from "@openrouter/sdk";
import { ProviderError } from "./errors";

dotenv.config();

let instance: OpenRouter | undefined;

export function getClient(): OpenRouter {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey)
    throw new ProviderError(
      "OpenRouter API key is not configured. Set OPENROUTER_API_KEY in .env or choose a configured local provider.",
      "authentication",
      false,
    );
  instance ??= new OpenRouter({ apiKey });
  return instance;
}
