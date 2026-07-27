import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getActiveServiceWorkerScriptUrl,
  isSecureContext,
  isServiceWorkerControlled,
  isStandaloneDisplayMode,
  prefersReducedMotion,
} from "./environmentContext.ts";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("isSecureContext", () => {
  it("reflects window.isSecureContext", () => {
    vi.stubGlobal("window", { isSecureContext: true });
    expect(isSecureContext()).toBe(true);

    vi.stubGlobal("window", { isSecureContext: false });
    expect(isSecureContext()).toBe(false);
  });
});

describe("isServiceWorkerControlled", () => {
  it("is false when the API is unsupported", () => {
    vi.stubGlobal("navigator", {});
    expect(isServiceWorkerControlled()).toBe(false);
  });

  it("is false when no active worker controls the page", () => {
    vi.stubGlobal("navigator", { serviceWorker: { controller: null } });
    expect(isServiceWorkerControlled()).toBe(false);
  });

  it("is true when a worker controls the page", () => {
    vi.stubGlobal("navigator", { serviceWorker: { controller: {} } });
    expect(isServiceWorkerControlled()).toBe(true);
  });
});

describe("getActiveServiceWorkerScriptUrl", () => {
  it("is undefined when the API is unsupported", () => {
    vi.stubGlobal("navigator", {});
    expect(getActiveServiceWorkerScriptUrl()).toBeUndefined();
  });

  it("is undefined when no worker controls the page", () => {
    vi.stubGlobal("navigator", { serviceWorker: { controller: null } });
    expect(getActiveServiceWorkerScriptUrl()).toBeUndefined();
  });

  it("returns the controlling worker's script URL", () => {
    vi.stubGlobal("navigator", {
      serviceWorker: { controller: { scriptURL: "https://example.test/sw.js" } },
    });
    expect(getActiveServiceWorkerScriptUrl()).toBe("https://example.test/sw.js");
  });
});

describe("isStandaloneDisplayMode", () => {
  it("prefers navigator.standalone when present", () => {
    vi.stubGlobal("navigator", { standalone: true });
    vi.stubGlobal("window", { matchMedia: () => ({ matches: false }) });
    expect(isStandaloneDisplayMode()).toBe(true);
  });

  it("falls back to the display-mode media query", () => {
    vi.stubGlobal("navigator", {});
    vi.stubGlobal("window", {
      matchMedia: (query: string) => ({
        matches: query === "(display-mode: standalone)",
      }),
    });
    expect(isStandaloneDisplayMode()).toBe(true);
  });

  it("is false when neither signal is available", () => {
    vi.stubGlobal("navigator", {});
    vi.stubGlobal("window", {});
    expect(isStandaloneDisplayMode()).toBe(false);
  });
});

describe("prefersReducedMotion", () => {
  it("is true when the reduced-motion media query matches", () => {
    vi.stubGlobal("window", {
      matchMedia: (query: string) => ({
        matches: query === "(prefers-reduced-motion: reduce)",
      }),
    });
    expect(prefersReducedMotion()).toBe(true);
  });

  it("is false when the reduced-motion media query does not match", () => {
    vi.stubGlobal("window", { matchMedia: () => ({ matches: false }) });
    expect(prefersReducedMotion()).toBe(false);
  });

  it("is false when window.matchMedia isn't a function", () => {
    vi.stubGlobal("window", {});
    expect(prefersReducedMotion()).toBe(false);
  });
});
