/** Supported exact post URLs. Listing/search/profile pages must not be treated as a post. */
export function isSocialMediaUrl(raw: string): boolean {
  try {
    const host = new URL(raw).hostname.toLowerCase().replace(/^www\./, '').replace(/^m\./, '');
    return host === 'instagram.com' || host.endsWith('.instagram.com') || host === 'tiktok.com' || host.endsWith('.tiktok.com') || host === 'facebook.com' || host.endsWith('.facebook.com') || host === 'fb.watch' || host === 'x.com' || host.endsWith('.x.com') || host === 'twitter.com' || host.endsWith('.twitter.com');
  } catch {
    return false;
  }
}

export function isSinglePostMediaUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase().replace(/^www\./, '').replace(/^m\./, '');
    const parts = url.pathname.split('/').filter(Boolean);
    if (host === 'instagram.com' || host.endsWith('.instagram.com')) return parts.length >= 2 && ['p', 'reel', 'reels', 'tv'].includes(parts[0] ?? '');
    if (host === 'tiktok.com' || host.endsWith('.tiktok.com')) return /^@[^/]+$/.test(parts[0] ?? '') && ['photo', 'video'].includes(parts[1] ?? '') && /^\d+$/.test(parts[2] ?? '');
    if (host === 'facebook.com' || host.endsWith('.facebook.com') || host === 'fb.watch') {
      if (['posts', 'videos'].includes(parts[1] ?? '') && !!parts[2]) return true;
      if (parts[0] === 'share' && ['p', 'v'].includes(parts[1] ?? '')) return !!parts[2];
      if (['reel', 'reels', 'posts', 'videos', 'permalink'].includes(parts[0] ?? '')) return !!parts[1];
      return (parts[0] === 'watch' && !!url.searchParams.get('v')) || (url.pathname === '/photo.php' && !!url.searchParams.get('fbid'));
    }
    if (host === 'x.com' || host.endsWith('.x.com') || host === 'twitter.com' || host.endsWith('.twitter.com')) return parts.length >= 3 && parts[1] === 'status' && /^\d+$/.test(parts[2] ?? '');
    return false;
  } catch {
    return false;
  }
}
