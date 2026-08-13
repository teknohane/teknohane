// Teknohane — Firebase Cloud Messaging Service Worker (yalnızca web/PWA bildirimleri için).
// Native Android uygulaması kendi push altyapısını kullanır (bkz. cloudflare-push-worker.js +
// @capacitor/push-notifications) — bu dosyaya hiç dokunmaz. index.html'deki setupPushWeb()
// tarafından '/teknohane/firebase-cloud-messaging-push-scope' scope'unda kaydedilir.
importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyD3hhCfOBC1u042BlffXz975uez2oL4D4I",
  authDomain: "teknohane-app.firebaseapp.com",
  projectId: "teknohane-app",
  storageBucket: "teknohane-app.firebasestorage.app",
  messagingSenderId: "957053322637",
  appId: "1:957053322637:web:8a05980b9c19f9c2e929c4"
});

const messaging = firebase.messaging();

// Sekme arka plandayken/kapalıyken gelen bildirimler için yedek gösterim — tarayıcı FCM'in
// webpush.notification alanından genelde zaten otomatik gösteriyor, bu yalnızca ek güvence
// (ör. bazı tarayıcı/OS kombinasyonlarında otomatik gösterim atlanabiliyor).
messaging.onBackgroundMessage((payload) => {
  const n = payload.notification || {};
  const link = payload.fcmOptions?.link || payload.data?.link || '/teknohane/';
  self.registration.showNotification(n.title || 'Teknohane', {
    body: n.body || '',
    icon: n.image || '/teknohane/icons/icon-192.png',
    badge: '/teknohane/icons/icon-96.png',
    data: { link }
  });
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const link = event.notification.data?.link || '/teknohane/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if ('focus' in client) { client.navigate(link).catch(() => {}); return client.focus(); }
      }
      if (clients.openWindow) return clients.openWindow(link);
    })
  );
});
