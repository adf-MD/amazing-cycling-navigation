import { describe, expect, it } from "vitest";
import { isValidHttpHeaderValue, normaliseApiKey } from "./apiKeyValidation.ts";

// A representative, syntactically plausible key shape — not a verified
// sample of HeiGIT's actual clipboard output, which this project has no
// way to independently confirm.
const REPRESENTATIVE_KEY = "5b3ce3597851110001cf6248a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6";

describe("normaliseApiKey", () => {
  it("leaves a clean key unchanged", () => {
    expect(normaliseApiKey(REPRESENTATIVE_KEY)).toBe(REPRESENTATIVE_KEY);
  });

  it("removes leading/trailing ordinary whitespace", () => {
    expect(normaliseApiKey(`  ${REPRESENTATIVE_KEY}  `)).toBe(REPRESENTATIVE_KEY);
    expect(normaliseApiKey(`\t${REPRESENTATIVE_KEY}\t`)).toBe(REPRESENTATIVE_KEY);
  });

  it("removes a trailing LF entirely", () => {
    expect(normaliseApiKey(`${REPRESENTATIVE_KEY}\n`)).toBe(REPRESENTATIVE_KEY);
  });

  it("removes a trailing CRLF entirely", () => {
    expect(normaliseApiKey(`${REPRESENTATIVE_KEY}\r\n`)).toBe(REPRESENTATIVE_KEY);
  });

  it("never changes internal characters, including an embedded LF", () => {
    const withEmbeddedLf = `abc\ndef`;
    expect(normaliseApiKey(withEmbeddedLf)).toBe(withEmbeddedLf);
  });

  it("never changes internal characters, including an embedded CRLF", () => {
    const withEmbeddedCrlf = `abc\r\ndef`;
    expect(normaliseApiKey(withEmbeddedCrlf)).toBe(withEmbeddedCrlf);
  });
});

describe("isValidHttpHeaderValue", () => {
  it("accepts a clean representative key", () => {
    expect(isValidHttpHeaderValue(REPRESENTATIVE_KEY)).toBe(true);
  });

  it("rejects an embedded LF", () => {
    expect(isValidHttpHeaderValue("abc\ndef")).toBe(false);
  });

  it("rejects an embedded CRLF", () => {
    expect(isValidHttpHeaderValue("abc\r\ndef")).toBe(false);
  });

  it("rejects an embedded NUL", () => {
    expect(isValidHttpHeaderValue("abc\0def")).toBe(false);
  });

  it("rejects DEL", () => {
    expect(isValidHttpHeaderValue("abc\x7Fdef")).toBe(false);
  });

  it("rejects other C0 control characters", () => {
    expect(isValidHttpHeaderValue("abc\x01def")).toBe(false);
    expect(isValidHttpHeaderValue("abc\x1Fdef")).toBe(false);
  });

  it("rejects an empty value", () => {
    expect(isValidHttpHeaderValue("")).toBe(false);
  });

  it("never includes the tested key in any thrown message (no exceptions thrown here at all)", () => {
    // isValidHttpHeaderValue is a pure boolean predicate — it cannot leak
    // the key via an exception message, since it never throws.
    expect(() => isValidHttpHeaderValue("abc\ndef")).not.toThrow();
  });
});
