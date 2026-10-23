import { afterEach, describe, expect, it, vi } from "vitest";
import { readAssistPref, writeAssistPref } from "./assistPref.js";

const store = new Map<string, string>();
const fakeWindow = { localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); } } };

describe("assist preference", () => {
  afterEach(() => { store.clear(); vi.unstubAllGlobals(); });

  it("defaults to on", () => {
    vi.stubGlobal("window", fakeWindow);
    expect(readAssistPref()).toBe(true);
  });

  it("remembers off", () => {
    vi.stubGlobal("window", fakeWindow);
    writeAssistPref(false);
    expect(readAssistPref()).toBe(false);
  });

  it("falls back to on when storage throws", () => {
    vi.stubGlobal("window", { localStorage: { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } } });
    expect(readAssistPref()).toBe(true);
    expect(() => writeAssistPref(false)).not.toThrow();
  });
});
