import { afterEach, describe, expect, mock, test } from "bun:test";
import * as storeModule from "../src/oauth/store";
import * as usabilityModule from "../src/codex/account-usability";
import * as modelRowsModule from "../src/server/management/model-rows";

let accountSets: Record<string, { accounts: Array<{ id: string; needsReauth?: boolean }>; activeAccountId?: string }> = {};
let usableCodexAccounts: Set<string> = new Set();
let managementRows: Array<Record<string, unknown>> = [];

mock.module("../src/oauth/store", () => ({
  ...storeModule,
  getAccountSet: (provider: string) => accountSets[provider] ?? null,
}));
mock.module("../src/codex/account-usability", () => ({
  ...usabilityModule,
  isCodexAccountUsable: (_config: unknown, accountId: string) => usableCodexAccounts.has(accountId),
}));
mock.module("../src/server/management/model-rows", () => ({
  ...modelRowsModule,
  listManagementModelRows: async () => managementRows,
}));

import {
  webSearchCandidateRows,
  webSearchModelIsRejected,
  webSearchModelOptionsFrom,
  webSearchModelRejection,
} from "../src/server/management/web-search-sidecar-options";
import { MAIN_CODEX_ACCOUNT_ID } from "../src/codex/account-id";
import type { OcxConfig, OcxProviderConfig } from "../src/types";

const forward: OcxProviderConfig = { adapter: "openai-responses", baseUrl: "https://chatgpt.com/backend-api/codex", authMode: "forward" };
const anthropicOAuth: OcxProviderConfig = { adapter: "anthropic", baseUrl: "https://api.anthropic.com", authMode: "oauth" };

function config(overrides: Partial<OcxConfig> = {}): OcxConfig {
  return { port: 10100, defaultProvider: "openai", providers: { openai: forward, claude: anthropicOAuth }, ...overrides };
}

afterEach(() => {
  accountSets = {};
  usableCodexAccounts = new Set();
  managementRows = [];
});

describe("web-search membership gate", () => {
  test("non-candidate id rejected with the filter named and allowed list attached", async () => {
    usableCodexAccounts.add(MAIN_CODEX_ACCOUNT_ID);
    managementRows = [{ provider: "openai", id: "gpt-5.6-terra", disabled: false, native: true }];
    const candidates = await webSearchCandidateRows(config());
    expect(webSearchModelIsRejected("o3-mini", candidates)).toBe(true);
    const rejection = webSearchModelRejection("webSearch.model", "o3-mini", candidates);
    expect(rejection.error).toContain("web-search sidecar candidate");
    expect(rejection.allowedModels).toContain("gpt-5.6-terra");
  });

  test("runnable candidate accepted", async () => {
    usableCodexAccounts.add(MAIN_CODEX_ACCOUNT_ID);
    managementRows = [{ provider: "openai", id: "gpt-5.6-terra", disabled: false, native: true }];
    const candidates = await webSearchCandidateRows(config());
    expect(webSearchModelIsRejected("gpt-5.6-terra", candidates)).toBe(false);
  });

  test("auth-slot models pass even with no login (settings must not be login-order-dependent)", async () => {
    const candidates = await webSearchCandidateRows(config());
    expect(candidates).toEqual([]);
    expect(webSearchModelIsRejected("gpt-5.6-luna", candidates)).toBe(false);
    expect(webSearchModelIsRejected("claude-haiku-4-5", candidates)).toBe(false);
  });
});

describe("option list", () => {
  test("persisted now-illegal model is display-grandfathered; new writes still rejected", async () => {
    usableCodexAccounts.add(MAIN_CODEX_ACCOUNT_ID);
    managementRows = [{ provider: "openai", id: "gpt-5.6-terra", disabled: false, native: true }];
    const cfg = config({ webSearchSidecar: { model: "legacy-model" } });
    const candidates = await webSearchCandidateRows(cfg);
    const options = webSearchModelOptionsFrom(cfg, candidates);
    expect(options.map(o => o.value)).toContain("legacy-model");
    expect(webSearchModelIsRejected("legacy-model", candidates)).toBe(true);
  });

  test("auth-slot options carry the slot flag; list is stably sorted", async () => {
    usableCodexAccounts.add(MAIN_CODEX_ACCOUNT_ID);
    accountSets = { claude: { accounts: [{ id: "a1" }], activeAccountId: "a1" } };
    managementRows = [{ provider: "openai", id: "gpt-5.6-terra", disabled: false, native: true }];
    const cfg = config();
    const options = webSearchModelOptionsFrom(cfg, await webSearchCandidateRows(cfg));
    expect(options.map(o => o.value)).toEqual(["claude-haiku-4-5", "gpt-5.6-luna", "gpt-5.6-terra"]);
    expect(options.find(o => o.value === "gpt-5.6-luna")?.authSlot).toBe(true);
  });
});
