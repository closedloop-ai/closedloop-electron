import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  dollarsToMicroCents,
  driftPct,
  microCentsFromInt,
  microCentsToDollars,
  parseAnthropicDollars,
  parseOpenAIDollars,
  sumMicroCents,
  type MicroCents,
} from "../src/main/cost-math.js";

describe("cost-math: dollarsToMicroCents", () => {
  test("converts whole dollars exactly", () => {
    assert.equal(dollarsToMicroCents(1), 1_000_000);
    assert.equal(dollarsToMicroCents(0), 0);
    assert.equal(dollarsToMicroCents(123.45), 123_450_000);
  });

  test("rounds half-up away from zero", () => {
    // 0.000_000_5 dollars = 0.5 microcents → rounds up to 1
    assert.equal(dollarsToMicroCents(0.0000005), 1);
    // -0.000_000_5 → rounds down to -1 (away from zero)
    assert.equal(dollarsToMicroCents(-0.0000005), -1);
  });

  test("rejects non-finite input", () => {
    assert.throws(() => dollarsToMicroCents(NaN));
    assert.throws(() => dollarsToMicroCents(Infinity));
    assert.throws(() => dollarsToMicroCents(-Infinity));
  });
});

describe("cost-math: microCentsToDollars", () => {
  test("round-trips through dollarsToMicroCents", () => {
    const cases = [0, 0.01, 0.123, 1.2345, 99.999_999];
    for (const c of cases) {
      const uc = dollarsToMicroCents(c);
      assert.ok(Math.abs(microCentsToDollars(uc) - c) < 1e-9, `case ${c}`);
    }
  });
});

describe("cost-math: parseAnthropicDollars", () => {
  test("parses standard decimal strings", () => {
    // "123.45" dollars → 123_450_000 microcents
    assert.equal(parseAnthropicDollars("123.45"), 123_450_000);
    assert.equal(parseAnthropicDollars("0"), 0);
    assert.equal(parseAnthropicDollars("0.000001"), 1);
  });

  test("rounds half-up at the seventh decimal", () => {
    // "0.0000005" → microcents fraction "000000" + cut digit 5 → rounds to 1
    assert.equal(parseAnthropicDollars("0.0000005"), 1);
  });

  test("handles negative values", () => {
    assert.equal(parseAnthropicDollars("-1.5"), -1_500_000);
  });

  test("rejects malformed input", () => {
    assert.throws(() => parseAnthropicDollars(""));
    assert.throws(() => parseAnthropicDollars("abc"));
    assert.throws(() => parseAnthropicDollars("1.2.3"));
    assert.throws(() => parseAnthropicDollars("1e10"));
    assert.throws(() => parseAnthropicDollars(".5"));
  });

  test("handles carry on rounding overflow", () => {
    // "0.9999995" — fraction "999999" + cut digit 5, rounds to 1_000_000 → carry
    // → "1.000000" microcents
    assert.equal(parseAnthropicDollars("0.9999995"), 1_000_000);
  });

  test("rejects non-string input", () => {
    assert.throws(() => parseAnthropicDollars(123 as unknown as string));
  });
});

describe("cost-math: parseOpenAIDollars", () => {
  test("delegates to dollarsToMicroCents", () => {
    assert.equal(parseOpenAIDollars(1.23), 1_230_000);
  });

  test("rejects non-numeric input", () => {
    assert.throws(() => parseOpenAIDollars("1" as unknown as number));
    assert.throws(() => parseOpenAIDollars(NaN));
  });
});

describe("cost-math: sumMicroCents", () => {
  test("sums a list", () => {
    assert.equal(
      sumMicroCents([1 as MicroCents, 2 as MicroCents, 3 as MicroCents]),
      6,
    );
  });

  test("returns zero for empty list", () => {
    assert.equal(sumMicroCents([]), 0);
  });

  test("detects overflow", () => {
    const huge = microCentsFromInt(Number.MAX_SAFE_INTEGER - 1);
    assert.throws(() => sumMicroCents([huge, huge]));
  });
});

describe("cost-math: driftPct", () => {
  test("vendor > local => positive drift", () => {
    const local = microCentsFromInt(80);
    const vendor = microCentsFromInt(100);
    assert.equal(driftPct(local, vendor), 20);
  });

  test("local > vendor => negative drift", () => {
    const local = microCentsFromInt(120);
    const vendor = microCentsFromInt(100);
    assert.equal(driftPct(local, vendor), -20);
  });

  test("returns null when vendor is zero", () => {
    const local = microCentsFromInt(5);
    const vendor = microCentsFromInt(0);
    assert.equal(driftPct(local, vendor), null);
  });
});

describe("cost-math: microCentsFromInt", () => {
  test("rejects non-integer", () => {
    assert.throws(() => microCentsFromInt(1.5));
  });

  test("rejects overflow", () => {
    assert.throws(() => microCentsFromInt(Number.MAX_SAFE_INTEGER + 10));
  });

  test("accepts safe integers", () => {
    assert.equal(microCentsFromInt(0), 0);
    assert.equal(microCentsFromInt(-1234), -1234);
  });
});
