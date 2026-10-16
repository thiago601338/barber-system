/* This worker never stores API responses, authentication, records or appointment data. */
const STATIC_CACHE = 'barber-client-static-v1'
const STATIC_FILES = ['/client-offline.html', '/client-offline.css', '/client-app-icon.svg']
self.addEventListener('install', event => { event.waitUntil(caches.open(STATIC_CACHE).then(cache => cache.addAll(STATIC_FILES))); self.skipWaiting() })
self.addEventListener('activate', event => { event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('barber-client-static-') && key !== STATIC_CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim())) })
self.addEventListener('fetch', event => {
 const request = event.request
 const url = new URL(request.url)
 if (request.method !== 'GET' || url.origin !== self.location.origin || request.headers.has('authorization')) return
 if (STATIC_FILES.includes(url.pathname) && !url.search) { event.respondWith(caches.open(STATIC_CACHE).then(cache => cache.match(request)).then(saved => saved || fetch(request))); return }
 if (request.mode === 'navigate' && (url.pathname === '/' || url.pathname.startsWith('/b/'))) {
  event.respondWith(fetch(request).catch(() => caches.open(STATIC_CACHE).then(cache => cache.match('/client-offline.html')).then(saved => saved || new Response('Sem conexão. Conecte-se para abrir sua conta.', {status:503,headers:{'content-type':'text/plain; charset=utf-8'}}))))
 }
})
