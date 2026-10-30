import { describe, expect, it } from 'vitest';
import { isSinglePostMediaUrl, isSocialMediaUrl } from '../src/shared/social-post';

describe('exact social post URL detection', () => {
  it.each([
    'https://www.instagram.com/p/DerwTyBnTOI/',
    'https://www.tiktok.com/@vexaro.4k/photo/7692114864516418868?q=wallpaper',
    'https://www.facebook.com/share/p/1F5BkZh6xF/',
    'https://www.facebook.com/reel/123456',
    'https://www.facebook.com/Anon.AstroFoto/posts/pfbid02cPvGUB5S8tFABxUgDrx3XscTZCiwQzRVo55jvy79LfsPZgbUaeFTiWtdqaHZy24fl',
    'https://www.facebook.com/creator/videos/123456/',
    'https://x.com/Elliza_19/status/2057092275717427617?a=DTWz-c5N_EDsLX76A78&s=20',
  ])('accepts %s', (url) => expect(isSinglePostMediaUrl(url)).toBe(true));

  it.each([
    'https://www.tiktok.com/search?q=wallpaper',
    'https://www.instagram.com/explore/',
    'https://www.instagram.com/creator/',
    'https://www.facebook.com/',
    'https://www.facebook.com/Anon.AstroFoto/posts/',
    'https://www.facebook.com/creator/videos/',
  ])('rejects listing %s', (url) => expect(isSinglePostMediaUrl(url)).toBe(false));
});

it('recognizes social feed pages so page-wide collection can be blocked there', () => {
  expect(isSocialMediaUrl('https://www.tiktok.com/search?q=wallpaper')).toBe(true);
  expect(isSocialMediaUrl('https://www.instagram.com/explore/')).toBe(true);
  expect(isSocialMediaUrl('https://www.facebook.com/')).toBe(true);
  expect(isSocialMediaUrl('https://x.com/Elliza_19/status/2057092275717427617')).toBe(true);
  expect(isSocialMediaUrl('https://example.com/gallery')).toBe(false);
});
