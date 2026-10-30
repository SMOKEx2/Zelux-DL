import { expect, it } from "vitest";
import type { DownloadItem } from "./types";
import { completionDetails } from "./completion";

const item = (overrides: Partial<DownloadItem> = {}) => ({
  id: "one", fileName: "one.jpg", saveDir: "C:\\Images", size: 100,
  downloaded: 100, lastTryAt: 1000, finishedAt: 2000, ...overrides,
} as DownloadItem);

it("keeps the single-file completion name, path and size", () => {
  const single = item();
  expect(completionDetails(single, [single])).toEqual({
    grouped: false, name: "one.jpg", path: "C:\\Images\\one.jpg", size: 100, took: 1, skipped: 0, allSkipped: false,
  });
});

it("shows the group folder with combined bytes and elapsed time", () => {
  const first = item({ saveDir: "C:\\Images\\facebook-10-30-26-22-30", media: { downloadGroup: "group" } });
  const second = item({ id: "two", size: 200, finishedAt: 4000, media: { downloadGroup: "group" } });
  expect(completionDetails(first, [first, second, item({ size: 999 })])).toEqual({
    grouped: true, name: "facebook-10-30-26-22-30", path: first.saveDir, size: 300, took: 3, skipped: 0, allSkipped: false,
  });
});

it("counts skipped duplicates without including them in the new folder's bytes", () => {
  const saved = item({ saveDir: "C:\\Images\\facebook-group", media: { downloadGroup: "group" } });
  const duplicate = item({ id: "dup", saveDir: "C:\\Old", media: { downloadGroup: "group", duplicateOf: "original" } });
  const details = completionDetails(duplicate, [saved, duplicate]);
  expect(details).toMatchObject({ name: "facebook-group", path: saved.saveDir, size: 100, grouped: true, skipped: 1, allSkipped: false });
});

it("opens the existing file when every selected file was a duplicate", () => {
  const duplicate = item({ media: { downloadGroup: "group", duplicateOf: "original" } });
  expect(completionDetails(duplicate, [duplicate])).toMatchObject({ grouped: false, path: "C:\\Images\\one.jpg", skipped: 1, allSkipped: true });
});
