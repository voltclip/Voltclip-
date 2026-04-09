// ══════════════════════════════════════════════════════════════════
// VoltClip Service Worker v7
// • COI (Cross-Origin Isolation) — SharedArrayBuffer / FFmpeg.wasm
// • PWA cache — offline shell
// ══════════════════════════════════════════════════════════════════

const CACHE_NAME = 'voltclip-v8'; // ← bumped v8 : fix Range request CORS → videos restaurées

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

  // Non-GET : laisser passer sans modification
  if (request.method !== 'GET') return;

  // Ignorer les endpoints Supabase REST / Auth / Realtime (non-storage)
  if (url.hostname.includes('supabase.co') && !url.pathname.startsWith('/storage/')) return;

  // Ignorer Google APIs internes (pas de support CORP/CORS adapté)
  if (url.hostname.includes('googleapis.com') && url.pathname.includes('/v1/')) return;

  // Ignorer Google Ads / Analytics / Tag Manager
  if (
    url.hostname.includes('googlesyndication.com')         ||
    url.hostname.includes('doubleclick.net')                ||
    url.hostname.includes('googleadservices.com')           ||
    url.hostname.includes('google-analytics.com')           ||
    url.hostname.includes('googletagmanager.com')           ||
    url.hostname.includes('fundingchoicesmessages.google.com')
  ) return;

  // ── Range requests (streaming vidéo Cloudinary) ─────────────────
  // On ne met PAS en cache (ERR_CACHE_OPERATION_NOT_SUPPORTED sur ReadableStream partiel)
  // MAIS on injecte quand même CORP cross-origin pour que require-corp ne les bloque pas.
  // FIX v7 : anciennement on faisait `return` sans respondWith → pas de CORP → COEP bloquait
  // les vidéos Cloudinary avec require-corp → c'est pourquoi on utilisait credentialless.
  // Avec ce handler, on peut passer à require-corp (compatible Safari/iOS).
  if (request.headers.has('Range')) {
    event.respondWith(handleRangeRequest(request));
    return;
  }

  event.respondWith(handleRequest(request));
});

// ── Range handler : inject CORP, pas de cache ─────────────────────
// FIX CRITIQUE : les <video> font des Range requests en mode no-cors par défaut
// → réponse opaque → impossible d'injecter CORP → COEP require-corp bloque tout.
// Solution : on recrée la requête en mode cors pour les URLs cross-origin
// (Cloudinary supporte CORS + Range), ce qui donne une réponse non-opaque
// sur laquelle on peut injecter Cross-Origin-Resource-Policy: cross-origin.
async function handleRangeRequest(request) {
  try {
    const url = new URL(request.url);
    const isSameOrigin = url.origin === self.location.origin;

    const fetchReq = isSameOrigin
      ? request
      : new Request(request.url, {
          method:      'GET',
          mode:        'cors',       // ← force CORS pour éviter réponse opaque
          credentials: 'omit',       // pas de cookies sur CDN Cloudinary
          headers:     request.headers, // conserve le header Range
        });

    const response = await fetch(fetchReq);

    // Réponse opaque résiduelle (CDN qui refuse CORS) — on la laisse passer,
    // le navigateur la bloquera de toute façon avec require-corp, mais au moins
    // on ne génère pas d'erreur supplémentaire.
    if (response.type === 'opaque') return response;

    const headers = new Headers(response.headers);
    if (!headers.has('Cross-Origin-Resource-Policy')) {
      headers.set('Cross-Origin-Resource-Policy', 'cross-origin');
    }
    return new Response(response.body, {
      status:     response.status,
      statusText: response.statusText,
      headers,
    });
  } catch (_) {
    return new Response('', { status: 503 });
  }
}

// ── Requêtes normales : fetch + cache + COI headers ───────────────
async function handleRequest(request) {
  const url        = new URL(request.url);
  const isSameOrigin = url.origin === self.location.origin;

  // Pour les ressources cross-origin (Cloudinary, CDN…) on force mode:cors
  // afin d'obtenir une réponse non-opaque que l'on peut décorer avec CORP.
  const fetchRequest = isSameOrigin
    ? request
    : new Request(request.url, {
        method:      'GET',
        mode:        'cors',
        credentials: 'omit',
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

  // Réponse opaque résiduelle (ressource refusant CORS) : rien à faire
  if (response.type === 'opaque') return response;

  // Mise en cache same-origin uniquement
  if (response.ok && isSameOrigin) {
    const cache = await caches.open(CACHE_NAME);
    cache.put(request, response.clone()).catch(() => {});
  }

  return injectCOIHeaders(response, isSameOrigin);
}

/**
 * Injecte les headers COI nécessaires à crossOriginIsolated = true.
 *
 * COOP same-origin      — isole le contexte de navigation (onglet)
 * COEP require-corp     — exige CORP sur toutes les ressources cross-origin
 *                         FIX v7 : on est passé de "credentialless" à "require-corp"
 *                         car "credentialless" n'est PAS supporté par Safari/iOS
 *                         → crossOriginIsolated restait false sur iPhone/iPad
 *                         → SharedArrayBuffer indisponible → FFmpeg.wasm refusait de charger
 * CORP cross-origin     — autorise le chargement cross-origin (Cloudinary, CDN, fonts…)
 */
function injectCOIHeaders(response, isSameOrigin) {
  if (response.type === 'opaque') return response;

  const headers = new Headers(response.headers);

  if (isSameOrigin) {
    headers.set('Cross-Origin-Opener-Policy',  'same-origin');
    headers.set('Cross-Origin-Embedder-Policy', 'require-corp'); // ← était "credentialless" (Safari KO)
  }

  // CORP sur toutes les ressources (same-origin et cross-origin)
  // pour qu'elles passent le filtre COEP require-corp
  if (!headers.has('Cross-Origin-Resource-Policy')) {
    headers.set('Cross-Origin-Resource-Policy', 'cross-origin');
  }

  return new Response(response.body, {
    status:     response.status,
    statusText: response.statusText,
    headers,
  });
}
