import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { describe, test } from "node:test";

describe("production console transport guard", () => {
  test("main/server console output is limited to GatewayLogger transport", () => {
    const output = execFileSync(
      "rg",
      [
        "-n",
        "console\\.(log|warn|error)",
        "src/main",
        "src/server",
      ],
      { cwd: process.cwd(), encoding: "utf8" },
    );
    const matches = output.trim().split("\n").filter(Boolean);

    assert.equal(matches.length, 3);
    assert.ok(
      matches.every((line) => line.startsWith("src/main/gateway-logger.ts:")),
    );
    assert.ok(matches.some((line) => line.includes("console.error")));
    assert.ok(matches.some((line) => line.includes("console.warn")));
    assert.ok(matches.some((line) => line.includes("console.log")));
  });
});
