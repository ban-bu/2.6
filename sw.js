// 服务工作者 - 支持离线功能
const CACHE_NAME = 'vibe-meeting-v1';
const urlsToCache = [
    '/',
    '/index.html',
    '/styles.css',
    '/loading.css',
    '/app.js',
    'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap',
    'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css'
];

// 安装事件 - 缓存资源
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => {
                console.log('缓存已打开');
                return cache.addAll(urlsToCache);
            })
    );
});

// 获取事件 - 从缓存或网络获取资源
self.addEventListener('fetch', event => {
    event.respondWith(
        caches.match(event.request)
            .then(response => {
                // 缓存命中 - 返回响应
                if (response) {
                    return response;
                }
                return fetch(event.request);
            }
        )
    );
});

// 激活事件 - 清理旧缓存
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(cacheNames => {
            return Promise.all(
                cacheNames.map(cacheName => {
                    if (cacheName !== CACHE_NAME) {
                        return caches.delete(cacheName);
                    }
                })
            );
        })
    );
});