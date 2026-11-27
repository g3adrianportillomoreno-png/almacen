// Service Worker para PWA Almacén CDM (v2 - Sin interceptar Supabase ni causar errores al recargar)
const CACHE_NAME = 'cdm-almacen-v2';
const STATIC_ASSETS = [
  '/manifest.webmanifest',
  '/icon.svg',
  '/icon-192.png',
  '/icon-512.png',
  '/favicon.svg'
];

// Instalación: Pre-cachear solo recursos estáticos ligeros y activar inmediatamente
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

// Activación: Limpiar cachés viejas (v1) y tomar control inmediato
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

// Fetch: NUNCA interceptar peticiones externas (Supabase, APIs, WebSockets)
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  let reqUrl;
  try {
    reqUrl = new URL(event.request.url);
  } catch {
    return;
  }

  // Ignorar cualquier dominio externo (ej. supabase.co) para evitar bloqueos y errores
  if (reqUrl.origin !== self.location.origin) {
    return;
  }

  // Para navegaciones HTML: siempre red primero, fallback a /index.html solo si está offline
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(async () => {
        const cached = await caches.match('/index.html');
        return cached || new Response('Sin conexión a internet. Recarga cuando vuelva la señal.', {
          status: 503,
          headers: { 'Content-Type': 'text/plain; charset=utf-8' }
        });
      })
    );
    return;
  }

  // Para iconos/manifest locales: red primero con respaldo en caché
  if (STATIC_ASSETS.includes(reqUrl.pathname)) {
    event.respondWith(
      fetch(event.request)
        .then((res) => {
          if (res && res.status === 200) {
            const clone = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return res;
        })
        .catch(() => caches.match(event.request).then((c) => c || Response.error()))
    );
  }
});
