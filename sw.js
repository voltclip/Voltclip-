// ══════════════════════════════════════════════════════════════════
// VoltClip Service Worker v9
// • PWA cache — offline shell
// (COI/COOP/COEP supprimés — FFmpeg.wasm retiré)
// ══════════════════════════════════════════════════════════════════

const CACHE_NAME = 'voltclip-v10';

const PRECACHE = [
  './',
  './voltclip.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
];

// ── Install : précache du shell ────────────────────────────────────
self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(PRECACHE).catch(() => {}))
  );
});

// ── Activate : purge des anciens caches ───────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// ── Fetch : cache strategy simple (pas de headers COI) ────────────
self.addEventListener('fetch', event => {
  const { request } = event;

  // Non-GET : laisser passer
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Ignorer Supabase REST / Auth / Realtime
  if (url.hostname.includes('supabase.co') && !url.pathname.startsWith('/storage/')) return;

  // Ignorer Google Ads / Analytics / Tag Manager / APIs
  if (
    url.hostname.includes('googlesyndication.com') ||
    url.hostname.includes('doubleclick.net')        ||
    url.hostname.includes('googleadservices.com')   ||
    url.hostname.includes('google-analytics.com')   ||
    url.hostname.includes('googletagmanager.com')   ||
    url.hostname.includes('fundingchoicesmessages.google.com') ||
    (url.hostname.includes('googleapis.com') && url.pathname.includes('/v1/'))
  ) return;

  event.respondWith(handleRequest(request));
});

// ── Requêtes normales : network-first, fallback cache ─────────────
async function handleRequest(request) {
  const url = new URL(request.url);
  const isSameOrigin = url.origin === self.location.origin;

  let response;
  try {
    response = await fetch(request);
  } catch (_) {
    const cached = await caches.match(request);
    if (cached) return cached;
    return new Response('Offline', { status: 503 });
  }

  // Mise en cache same-origin uniquement
  if (response.ok && isSameOrigin) {
    const cache = await caches.open(CACHE_NAME);
    cache.put(request, response.clone()).catch(() => {});
  }

  return response;
}
