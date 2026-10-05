// Shared by the CLI and extension; only read images belonging to the requested post.
(function (root) {
  function isTikTokUrl(value) {
    try {
      const url = new URL(value);
      return url.protocol === 'https:' && !url.username && !url.password && !url.port && (url.hostname === 'tiktok.com' || url.hostname.endsWith('.tiktok.com'));
    } catch (_) { return false; }
  }

  function isTikTokPhotoUrl(value) {
    return isTikTokUrl(value) && /\/@[^/]+\/photo\/\d+(?:\/|$)/i.test(new URL(value).pathname);
  }

  function isTikTokShortUrl(value) {
    if (!isTikTokUrl(value)) return false;
    const url = new URL(value);
    return ['vm.tiktok.com', 'vt.tiktok.com'].includes(url.hostname) || /^\/t\//.test(url.pathname);
  }

  function imageUrl(value) {
    try {
      const url = new URL(value);
      const domains = ['tiktokcdn.com', 'tiktokcdn-us.com', 'tiktokcdn-eu.com', 'ibytedtos.com', 'byteoversea.com', 'ibyteimg.com', 'muscdn.com', 'tiktok.com'];
      if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
      if (!domains.some(domain => url.hostname === domain || url.hostname.endsWith(`.${domain}`))) return null;
      url.hash = '';
      return url.href;
    } catch (_) { return null; }
  }

  function normalizePost(post, targetUrl) {
    if (!isTikTokUrl(targetUrl) || !post || typeof post !== 'object') return null;
    const expectedId = new URL(targetUrl).pathname.match(/\/(?:photo|video)\/(\d+)/)?.[1];
    const id = String(post.id || post.aweme_id || '');
    if (!/^\d+$/.test(id) || expectedId && id !== expectedId) return null;
    const rawImages = post.imagePost?.images || post.image_post_info?.images;
    if (!Array.isArray(rawImages) || !rawImages.length || rawImages.length > 200) return null;
    const images = rawImages.map(image => {
      const address = image?.imageURL || image?.displayImage || image?.display_image || image || {};
      const candidates = address.urlList || address.url_list;
      const urls = Array.isArray(candidates) ? [...new Set(candidates.map(imageUrl).filter(Boolean))] : [];
      return { urls };
    });
    // Never silently report success for a subset of a carousel.
    if (images.some(image => !image.urls.length)) return null;
    return { id, title: String(post.desc || post.title || `TikTok photo ${id}`).slice(0, 120), images };
  }

  function parsePost(html, targetUrl) {
    if (!isTikTokUrl(targetUrl)) return null;
    for (const match of String(html || '').matchAll(/<script\b[^>]*\bid=["'](?:__UNIVERSAL_DATA_FOR_REHYDRATION__|SIGI_STATE|sigi-persisted-data)["'][^>]*>([\s\S]*?)<\/script>/gi)) {
      let data;
      try { data = JSON.parse(match[1]); } catch (_) { continue; }
      const scope = data.__DEFAULT_SCOPE__ || {};
      const item = scope['webapp.video-detail']?.itemInfo?.itemStruct || scope['webapp.photo-detail']?.itemInfo?.itemStruct;
      const candidates = [item, ...Object.values(data.ItemModule || {})];
      for (const candidate of candidates) {
        const result = normalizePost(candidate, targetUrl);
        if (result) return result;
      }
    }
    return null;
  }

  function normalizeCapture(value, urls) {
    if (!value || !isTikTokUrl(value.sourceUrl) || !Array.isArray(urls) || urls.length !== 1) return null;
    const target = urls[0];
    if (!isTikTokUrl(target)) return null;
    if (!isTikTokShortUrl(target)) {
      const id = new URL(target).pathname.match(/\/(?:photo|video)\/(\d+)/)?.[1];
      if (!id || id !== String(value.id)) return null;
    } else if (target !== value.sourceUrl) return null;
    if (!Array.isArray(value.images)) return null;
    const post = normalizePost({ id: value.id, desc: value.title, imagePost: { images: value.images.map(image => ({ urlList: image?.urls })) } }, value.sourceUrl);
    return post ? { ...post, sourceUrl: value.sourceUrl } : null;
  }

  function captureDocument(doc, sourceUrl) {
    const parsed = parsePost(doc.documentElement.outerHTML, sourceUrl);
    if (parsed) return { ...parsed, sourceUrl };
    const id = isTikTokUrl(sourceUrl) && new URL(sourceUrl).pathname.match(/\/(?:photo|video)\/(\d+)/)?.[1];
    if (!id) return null;
    // The SPA no longer includes itemStruct in its HTML. Bind a carousel to the
    // exact post ID in its component props; never scrape all images on the page.
    for (const article of doc.querySelectorAll('article')) {
      let fiber = article[Object.keys(article).find(key => key.startsWith('__reactFiber$'))];
      let matches = false;
      for (let depth = 0; fiber && depth < 16; depth++, fiber = fiber.return) {
        if (String(fiber.memoizedProps?.id) === id) { matches = true; break; }
      }
      if (!matches) continue;
      const slides = [...article.querySelectorAll('.swiper-wrapper > .swiper-slide:not(.swiper-slide-duplicate)')];
      if (!slides.length || slides.length > 200) continue;
      slides.sort((a, b) => Number(a.getAttribute('data-swiper-slide-index')) - Number(b.getAttribute('data-swiper-slide-index')));
      if (slides.some((slide, index) => slide.getAttribute('data-swiper-slide-index') !== String(index))) continue;
      const images = slides.map(slide => ({ urls: [slide.querySelector('img')?.src] }));
      const title = article.querySelector('[data-e2e="video-desc"]')?.textContent || `TikTok photo ${id}`;
      const post = normalizeCapture({ id, title, images, sourceUrl }, [sourceUrl]);
      if (post) return post;
    }
    return null;
  }

  const api = { isTikTokUrl, isTikTokPhotoUrl, isTikTokShortUrl, parsePost, normalizeCapture, captureDocument };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ZeluxTikTokPhotos = api;
})(globalThis);
