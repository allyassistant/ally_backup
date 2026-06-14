const CACHE_NAME = 'rapaport-calculator-v1';
const DATA_CACHE_NAME = 'rapaport-data-v1';

const FILES_TO_CACHE = [
  '/rapaport-calculator/',
  '/rapaport-calculator/index.html',
  '/rapaport-calculator/data.json'
];

// Install event - cache the app shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        return cache.addAll(FILES_TO_CACHE);
      })
      .then(() => self.skipWaiting())
  );
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME && cacheName !== DATA_CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch event - serve from cache, fallback to network
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Special handling for data.json - always check for updates
  if (url.pathname.includes('data.json')) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          // Update cache with fresh data
          const responseClone = response.clone();
          caches.open(DATA_CACHE_NAME).then((cache) => {
            cache.put(request, responseClone);
          });
          return response;
        })
        .catch(() => {
          // Fallback to cached data if offline
          return caches.match(request);
        })
    );
    return;
  }

  // For other requests, try cache first, then network
  event.respondWith(
    caches.match(request).then((response) => {
      if (response) {
        return response;
      }
      return fetch(request).then((response) => {
        // Cache new requests
        if (response.status === 200) {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(request, responseClone);
          });
        }
        return response;
      });
    })
  );
});

// Check for data updates periodically
self.addEventListener('message', (event) => {
  if (event.data === 'check-for-update') {
    checkForUpdate();
  }
});

async function checkForUpdate() {
  try {
    const response = await fetch('/rapaport-calculator/data.json', {
      cache: 'no-cache'
    });
    const newData = await response.json();
    
    const cachedResponse = await caches.match('/rapaport-calculator/data.json');
    if (cachedResponse) {
      const cachedData = await cachedResponse.json();
      if (newData.version !== cachedData.version) {
        // New version available, notify all clients
        const clients = await self.clients.matchAll();
        clients.forEach((client) => {
          client.postMessage({
            type: 'update-available',
            version: newData.version,
            date: newData.date
          });
        });
      }
    }
  } catch (error) {
    console.log('Update check failed:', error);
  }
}

// Check for updates every hour
setInterval(checkForUpdate, 60 * 60 * 1000);