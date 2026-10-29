import { createElement } from "react";
import { act, create } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";
import { api } from "../lib/api";

vi.stubGlobal("navigator", { userAgent: "Windows" });
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

describe("browser extension setup", () => {
  it("loads the bundled Chromium extension folder without extra steps", async () => {
    const folder = "C:\\ZeluxDL\\extension\\chromium";
    const getFolder = vi.spyOn(api, "extensionFolder").mockResolvedValue(folder);
    const { BrowserConnect } = await import("./BrowserConnect");
    let view: ReturnType<typeof create>;
    await act(async () => {
      view = create(createElement(BrowserConnect, { status: null, connected: false }));
    });
    expect(getFolder).toHaveBeenCalledWith(false);
    expect(JSON.stringify(view!.toJSON())).toContain(folder.replaceAll("\\", "\\\\"));
    await act(async () => view!.unmount());
    getFolder.mockRestore();
  });
});
