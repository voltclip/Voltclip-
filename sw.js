// VoltClip Service Worker — v1.2
const CACHE = 'voltclip-v2'
const ASSETS = [
  '/Voltclip/voltclip.html',
  '/Voltclip/manifest.json',
  '/Voltclip/mentions-legales.html',
  '/Voltclip/politique-confidentialite.html',
  '/Voltclip/cgu.html',
  '/Voltclip/cookies.html',
  'https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&family=DM+Sans:wght@400;500;700&display=swap',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2'
]

// Installation — mise en cache des assets statiques
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(cache => {
      return Promise.allSettled(
        ASSETS.map(url => cache.add(url).catch(() => {}))
      )
    })
  )
  self.skipWaiting()
})

// Activation — nettoyage des anciens caches
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  )
  self.clients.claim()
})

// Fetch — stratégie Network First pour l'app, Cache First pour les assets
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url)

  // Ne pas intercepter les requêtes Supabase, Cloudinary, AdSense
  if (
    url.hostname.includes('supabase.co') ||
    url.hostname.includes('cloudinary.com') ||
    url.hostname.includes('googlesyndication') ||
    url.hostname.includes('googletagmanager') ||
    url.hostname.includes('googleapis.com') && url.pathname.includes('pagead')
  ) {
    return
  }

  // Pour les fichiers HTML — Network First (toujours version fraîche)
  if (e.request.mode === 'navigate' || url.pathname.endsWith('.html')) {
    e.respondWith(
      fetch(e.request)
        .then(res => {
          const clone = res.clone()
          caches.open(CACHE).then(c => c.put(e.request, clone))
          return res
        })
        .catch(() => caches.match(e.request))
    )
    return
  }

  // Pour les autres assets — Cache First
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached
      return fetch(e.request).then(res => {
        if (res && res.status === 200) {
          const clone = res.clone()
          caches.open(CACHE).then(c => c.put(e.request, clone))
        }
        return res
      }).catch(() => cached)
    })
  )
})
