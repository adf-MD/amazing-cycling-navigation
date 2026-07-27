/// <reference lib="dom" />
import { expect, test } from "@playwright/test";

/**
 * Investigates whether calling `window.fetch` detached from its receiver
 * produces a synchronous "Illegal invocation"-style exception in a real
 * browser engine — jsdom (used by the Vitest suite) does not reproduce
 * this at all: its own fetch implementation never throws when detached,
 * so this can only be established against a real browser.
 *
 * Uses a `data:` URL Request so this is fully hermetic — no live network
 * or API dependency, safe to run in any sandbox.
 *
 * CONFIRMED RESULT (Chromium, this project's only locally runnable
 * engine — see the completion report for the WebKit/iOS coverage gap):
 * a bare detached reference (`const f = window.fetch; f(request)`) does
 * NOT throw, but calling fetch held as a plain object property (`const
 * holder = { fetchImpl: window.fetch }; holder.fetchImpl(request)`) DOES
 * throw `TypeError: Failed to execute 'fetch' on 'Window': Illegal
 * invocation` — and the second form is exactly what
 * OpenRouteServiceAdapter used before this investigation
 * (`this.fetchImpl = options.fetchImpl ?? fetch`, later called as
 * `this.fetchImpl(request)`). This is why the adapter now binds its
 * default fetch implementation explicitly (see
 * openRouteServiceAdapter.ts's constructor) — a fix applied only after,
 * and because of, this test proving the problem, not speculatively.
 */
test("native fetch throws when called as an object property but not when called detached — confirms the real cause and pins the browser behaviour", async ({
  page,
}) => {
  await page.goto("/");

  const result = await page.evaluate(async () => {
    const request = new Request("data:text/plain,hello");

    const detachedResult: { threw: boolean; name?: string; message?: string } = {
      threw: false,
    };
    try {
      // eslint-disable-next-line @typescript-eslint/unbound-method -- intentional: this exact detachment is what's under test.
      const detachedFetch = window.fetch;
      await detachedFetch(request.clone());
    } catch (error) {
      detachedResult.threw = true;
      detachedResult.name = error instanceof Error ? error.name : String(error);
      detachedResult.message = error instanceof Error ? error.message : "";
    }

    const propertyResult: { threw: boolean; name?: string; message?: string } = {
      threw: false,
    };
    try {
      // Exactly OpenRouteServiceAdapter's pre-fix shape: a fetch
      // reference stored as a plain object property, invoked as
      // `holder.fetchImpl(...)`.
      // eslint-disable-next-line @typescript-eslint/unbound-method -- intentional: this exact detachment is what's under test.
      const holder = { fetchImpl: window.fetch };
      await holder.fetchImpl(request.clone());
    } catch (error) {
      propertyResult.threw = true;
      propertyResult.name = error instanceof Error ? error.name : String(error);
      propertyResult.message = error instanceof Error ? error.message : "";
    }

    return { detachedResult, propertyResult };
  });

  await test.info().attach("fetch-invocation-result", {
    body: JSON.stringify(result, null, 2),
    contentType: "application/json",
  });

  expect(result.detachedResult.threw).toBe(false);
  expect(result.propertyResult.threw).toBe(true);
  expect(result.propertyResult.name).toBe("TypeError");
  expect(result.propertyResult.message).toContain("Illegal invocation");
});

test("the fix (binding fetch explicitly before storing it as a property) resolves the invocation failure", async ({
  page,
}) => {
  await page.goto("/");

  const result = await page.evaluate(async () => {
    const request = new Request("data:text/plain,hello");
    // The exact statement OpenRouteServiceAdapter's constructor now uses.
    const holder = { fetchImpl: globalThis.fetch.bind(globalThis) };
    try {
      await holder.fetchImpl(request);
      return { threw: false };
    } catch (error) {
      return {
        threw: true,
        name: error instanceof Error ? error.name : String(error),
        message: error instanceof Error ? error.message : "",
      };
    }
  });

  expect(result.threw).toBe(false);
});
