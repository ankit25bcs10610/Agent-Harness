import { watch, type FSWatcher } from "node:fs";
import { join } from "node:path";
import {
  buildRepositoryIndex,
  loadRepositoryIndex,
  reconcileIndex,
  saveRepositoryIndex,
} from "./index";
import type { IntelligenceOptions, IndexChanges } from "./types";

export type IndexWatch = {
  close: () => void;
  refresh: () => Promise<IndexChanges>;
};

export async function watchRepository(
  options: IntelligenceOptions,
  onChange?: (changes: IndexChanges) => void,
): Promise<IndexWatch> {
  const indexPath = join(options.root, ".chiku", "repository-index.json");
  let current = await loadRepositoryIndex(indexPath);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running: Promise<IndexChanges> | undefined;
  const refresh = async () => {
    if (running) return running;
    running = (async () => {
      const next = await buildRepositoryIndex(
        options,
        new AbortController().signal,
      );
      const changes = reconcileIndex(current, next);
      await saveRepositoryIndex(next, indexPath);
      current = next;
      onChange?.(changes);
      return changes;
    })();
    try {
      return await running;
    } finally {
      running = undefined;
    }
  };
  const watcher: FSWatcher = watch(options.root, { recursive: true }, () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      void refresh();
    }, 150);
  });
  return {
    close: () => {
      if (timer) clearTimeout(timer);
      watcher.close();
    },
    refresh,
  };
}
