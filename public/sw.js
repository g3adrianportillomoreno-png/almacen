// Service Worker para PWA Almacén CDM
const CACHE_NAME = 'cdm-almacen-v1';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/icon.svg',
  '/icon-192.png',
  '/icon-512.png',
  '/favicon.svg'
];

// Instalación: Pre-cachear el shell básico
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS).catch((err) => {
        console.warn('SW pre-cache advertencia:', err);
      });
    })
  );
  self.skipWaiting();
});

// Activación: Tomar control inmediato y limpiar cachés obsoletas
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch: Network First con fallback a caché para navegación estática
self.addEventListener('fetch', (event) => {
  // Ignorar peticiones no HTTP/HTTPS o peticiones de Supabase/API externas para mantenerlas en vivo
  if (!event.request.url.startsWith('http')) return;
  
  if (event.request.method !== 'GET') {
    return;
  }

  // Para peticiones de navegación o recursos estáticos, intentar red primero
  event.respondWith(
    fetch(event.request)
      .then((networkResponse) => {
        // Si la respuesta es válida, clonar y actualizar en caché si es del mismo origen
        if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
        }
        return networkResponse;
      })
      .catch(() => {
        // Si no hay red, servir desde caché
        return caches.match(event.request).then((cachedResponse) => {
          if (cachedResponse) {
            return cachedResponse;
          }
          // Si es una navegación HTML y falló la red, servir index.html
          if (event.request.mode === 'navigate') {
            return caches.match('/index.html');
          }
        });
      })
  );
});
