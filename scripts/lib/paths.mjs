import { homedir } from "node:os";
import { join } from "node:path";

export const DATA_DIR = join(homedir(), ".blog-loop");
export const QUEUE_DIR = join(DATA_DIR, "queue");
export const DRAFTS_DIR = join(DATA_DIR, "drafts");
export const SECRETS_DIR = join(DATA_DIR, "secrets");
export const CONFIG_PATH = join(DATA_DIR, "config.json");
export const PUBLISH_LOG = join(DATA_DIR, "publish-log.jsonl");
export const LOG_FILE = join(DATA_DIR, "log.jsonl");
export const PAUSE_FILE = join(DATA_DIR, "PAUSE");
