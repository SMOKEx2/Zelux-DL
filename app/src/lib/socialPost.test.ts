import { describe, expect, it } from "vitest";
import { initialMediaSelection, isSinglePostMediaUrl } from "./socialPost";

describe("single-post media URLs", () => {
  it.each([
    "https://www.instagram.com/p/DerwTyBnTOI/",
    "https://www.instagram.com/reel/abc123/",
    "https://www.tiktok.com/@vexaro.4k/photo/7692114864516418868?q=wallpaper",
    "https://www.tiktok.com/@creator/video/1234567890",
    "https://www.facebook.com/share/p/1F5BkZh6xF/",
    "https://www.facebook.com/reel/123456789",
    "https://www.facebook.com/watch/?v=123456",
    "https://www.facebook.com/Anon.AstroFoto/posts/pfbid02cPvGUB5S8tFABxUgDrx3XscTZCiwQzRVo55jvy79LfsPZgbUaeFTiWtdqaHZy24fl",
    "https://www.facebook.com/creator/videos/123456/",
    "https://x.com/Elliza_19/status/2057092275717427617?a=DTWz-c5N_EDsLX76A78&s=20",
  ])("accepts one post: %s", (url) => expect(isSinglePostMediaUrl(url)).toBe(true));

  it.each([
    "https://www.tiktok.com/search?q=wallpaper",
    "https://www.instagram.com/explore/",
    "https://www.instagram.com/creator/",
    "https://www.facebook.com/",
    "https://www.facebook.com/Anon.AstroFoto/posts/",
    "https://www.facebook.com/creator/videos/",
    "https://example.com/post/123",
    "not a url",
  ])("rejects listings and non-post URLs: %s", (url) => expect(isSinglePostMediaUrl(url)).toBe(false));
});

it("does not preselect a post's entire media set", () => {
  expect(initialMediaSelection(["one", "two"], true)).toEqual(new Set());
});

it("keeps playlist auto-selection unchanged for non-post URLs", () => {
  expect(initialMediaSelection(["one", "two"], false)).toEqual(new Set(["one", "two"]));
});
