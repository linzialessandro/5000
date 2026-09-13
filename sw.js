const CACHE = '5000-v23';
const ASSETS = [
    './',
    'index.html',
    'app.js',
    'styles.css',
    'manifest.webmanifest',
    'assets/bg-portrait.jpg',
    'assets/bg-wide.jpg',
    'assets/ivory.jpg',
    'assets/marble.jpg',
    'assets/die.png',
    'assets/icon-512.jpg',
    'assets/apple-touch-icon.png',
    'assets/favicon.png',
    'assets/roll/01.png',
    'assets/roll/02.png',
    'assets/roll/03.png',
    'assets/roll/04.png',
    'assets/roll/05.png',
    'assets/roll/06.png',
    'assets/roll/07.png',
    'assets/roll/08.png',
    'assets/roll/09.png',
    'assets/roll/10.png',
    'assets/roll/11.png',
    'assets/roll/12.png',
    'assets/roll/13.png',
    'assets/roll/14.png'
];
self.addEventListener('install', e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', e => {
    if (e.request.method !== 'GET') return;
    e.respondWith(fetch(e.request).then(r => { const c = r.clone(); caches.open(CACHE).then(cache => cache.put(e.request, c)); return r; }).catch(() => caches.match(e.request)));
});
