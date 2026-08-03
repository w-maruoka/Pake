import { spawnSync } from "node:child_process";

import { describe, expect, it } from "vitest";

function runDryBuild(extraArgs = []) {
  return spawnSync(
    process.execPath,
    [
      "scripts/pake-ops.mjs",
      "build-app",
      "--preset",
      "chatgpt",
      "--app-version",
      "1.0.9",
      "--dry-run",
      ...extraArgs,
    ],
    { encoding: "utf8" },
  );
}

describe("personal Pake build helper", () => {
  it("requests microphone access for the ChatGPT preset", () => {
    const result = runDryBuild();

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("-f microphone=true");
  });

  it("allows an explicit text-only ChatGPT build", () => {
    const result = runDryBuild(["--no-microphone"]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("-f microphone=false");
  });
});
