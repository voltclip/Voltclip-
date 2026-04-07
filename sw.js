// ══════════════════════════════════════════════════════════════════
// VoltClip Service Worker
// • COI (Cross-Origin Isolation) — SharedArrayBuffer / FFmpeg.wasm
// • PWA cache — offline shell
// ══════════════════════════════════════════════════════════════════

const CACHE_NAME = 'voltclip-v3';

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

  // Ne pas intercepter les requêtes Supabase / API (POST, etc.)
  if (request.method !== 'GET') return;
  if (url.hostname.includes('supabase.co')) return;
  if (url.hostname.includes('googleapis.com') && url.pathname.includes('/v1/')) return;

  event.respondWith(handleRequest(request));
});

async function handleRequest(request) {
  const url = new URL(request.url);
  const isSameOrigin = url.origin === self.location.origin;

  // ── Stratégie cache : Network-first pour le HTML, Cache-first pour assets ──
  let response;
  try {
    response = await fetch(request);
  } catch (_) {
    // Réseau indisponible → essayer le cache
    const cached = await caches.match(request);
    if (cached) return injectCOIHeaders(cached, isSameOrigin);
    return new Response('Offline', { status: 503 });
  }

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
 * - COOP same-origin : isole le contexte de navigation
 * - COEP require-corp : bloque les ressources sans CORP
 * - CORP cross-origin : autorise les ressources cross-origin (Cloudinary, CDN…)
 *
 * Pour les ressources cross-origin (Cloudinary, unpkg, etc.) on ajoute
 * uniquement CORP:cross-origin afin que COEP les accepte.
 */
function injectCOIHeaders(response, isSameOrigin) {
  // Réponses opaques (mode:no-cors) — on ne peut pas modifier leurs headers
  if (response.type === 'opaque') return response;

  const headers = new Headers(response.headers);

  if (isSameOrigin) {
    // Headers d'isolation complets sur la page principale et les assets same-origin
    headers.set('Cross-Origin-Opener-Policy',   'same-origin');
    headers.set('Cross-Origin-Embedder-Policy',  'require-corp');
  }

  // Toujours ajouter CORP cross-origin pour que les ressources externes
  // (Cloudinary, unpkg, fonts…) passent le filtre COEP
  if (!headers.has('Cross-Origin-Resource-Policy')) {
    headers.set('Cross-Origin-Resource-Policy', 'cross-origin');
  }

  return new Response(response.body, {
    status:     response.status,
    statusText: response.statusText,
    headers,
  });
}
