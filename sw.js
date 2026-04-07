// ══════════════════════════════════════════════════════════════════
// VoltClip Service Worker
// • COI (Cross-Origin Isolation) — SharedArrayBuffer / FFmpeg.wasm
// • PWA cache — offline shell
// ══════════════════════════════════════════════════════════════════

const CACHE_NAME = 'voltclip-v5';

// Ressources de l'app shell à précacher
const PRECACHE = [
  './',
  './voltclip.html',
  './manifest.json',
  './icon-192.png',
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

// ── Fetch : COI headers + cache strategy ──────────────────────────
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Ne pas intercepter les requêtes non-GET
  if (request.method !== 'GET') return;

  // Ne pas intercepter les range requests (streaming vidéo — 206 Partial Content)
  // → cloner un ReadableStream partiel est impossible → ERR_CACHE_OPERATION_NOT_SUPPORTED
  if (request.headers.has('Range')) return;

  // Ignorer les endpoints Supabase REST / Auth / Realtime (non-storage)
  // mais laisser passer /storage/ (avatars, etc.) pour y injecter les headers COI
  if (url.hostname.includes('supabase.co') && !url.pathname.startsWith('/storage/')) return;

  // Ignorer les appels API Google
  if (url.hostname.includes('googleapis.com') && url.pathname.includes('/v1/')) return;

  // Ignorer Google Ads / Analytics / Tag Manager (pas de support CORS → 503 sinon)
  if (
    url.hostname.includes('googlesyndication.com') ||
    url.hostname.includes('doubleclick.net')        ||
    url.hostname.includes('googleadservices.com')   ||
    url.hostname.includes('google-analytics.com')   ||
    url.hostname.includes('googletagmanager.com')
  ) return;

  event.respondWith(handleRequest(request));
});

async function handleRequest(request) {
  const url = new URL(request.url);
  const isSameOrigin = url.origin === self.location.origin;

  // ── Pour les ressources cross-origin (Cloudinary, Supabase storage…)
  // on force le mode CORS afin d'obtenir une réponse non-opaque
  // que l'on peut ensuite décorer avec les headers COI.
  // Les images/vidéos sans attribut `crossorigin` font des requêtes
  // no-cors → réponse opaque → impossible d'ajouter CORP → COEP bloque.
  const fetchRequest = isSameOrigin
    ? request
    : new Request(request.url, {
        method:      'GET',
        mode:        'cors',
        credentials: 'omit',   // pas de cookies pour les CDN tiers
        headers:     request.headers,
      });

  let response;
  try {
    response = await fetch(fetchRequest);
  } catch (_) {
    // Réseau indisponible → essayer le cache
    const cached = await caches.match(request);
    if (cached) return injectCOIHeaders(cached, isSameOrigin);
    return new Response('Offline', { status: 503 });
  }

  // Réponses opaques résiduelles (ressource refusant CORS) — on ne peut rien faire
  if (response.type === 'opaque') return response;

  // Mettre en cache les ressources same-origin et les assets stables
  if (response.ok && isSameOrigin) {
    const cache = await caches.open(CACHE_NAME);
    cache.put(request, response.clone()).catch(() => {});
  }

  return injectCOIHeaders(response, isSameOrigin);
}

/**
 * Injecte les headers COOP / COEP / CORP nécessaires à crossOriginIsolated.
 *
 * - COOP same-origin      : isole le contexte de navigation
 * - COEP require-corp     : bloque les ressources sans CORP
 * - CORP cross-origin     : autorise les ressources cross-origin (Cloudinary, CDN…)
 */
function injectCOIHeaders(response, isSameOrigin) {
  // Réponses opaques (mode:no-cors) — on ne peut pas modifier leurs headers
  if (response.type === 'opaque') return response;

  const headers = new Headers(response.headers);

  if (isSameOrigin) {
    // Headers d'isolation complets sur la page principale et les assets same-origin
    headers.set('Cross-Origin-Opener-Policy',  'same-origin');
    headers.set('Cross-Origin-Embedder-Policy', 'require-corp');
  }

  // Toujours ajouter CORP cross-origin pour que les ressources externes
  // (Cloudinary, Supabase storage, unpkg, fonts…) passent le filtre COEP
  if (!headers.has('Cross-Origin-Resource-Policy')) {
    headers.set('Cross-Origin-Resource-Policy', 'cross-origin');
  }

  return new Response(response.body, {
    status:     response.status,
    statusText: response.statusText,
    headers,
  });
}
