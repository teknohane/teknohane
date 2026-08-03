// Teknohane — Firebase Cloud Messaging Service Worker (yalnızca web/PWA bildirimleri için).
// Native Android uygulaması kendi push altyapısını kullanır (bkz. cloudflare-push-worker.js +
// @capacitor/push-notifications) — bu dosyaya hiç dokunmaz. index.html'deki setupPushWeb()
// tarafından './firebase-cloud-messaging-push-scope' (göreceli) scope'unda kaydedilir — bu dosya
// GitHub Pages'te (/teknohane/ alt yolu) VE Firebase Hosting'te (kök dizin) AYNI haliyle çalışır,
// çünkü aşağıdaki fallback path'ler self.registration.scope'tan DİNAMİK hesaplanıyor.
importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyADpIRNLQEIer_gplTgwKi_EKkfcyrYoqY",
  authDomain: "maasgunu-bd353.firebaseapp.com",
  projectId: "maasgunu-bd353",
  storageBucket: "maasgunu-bd353.firebasestorage.app",
  messagingSenderId: "485904329467",
  appId: "1:485904329467:web:579d932ae8f25958901e5e"
});

const messaging = firebase.messaging();

// Sekme arka plandayken/kapalıyken gelen bildirimler için yedek gösterim — tarayıcı FCM'in
// webpush.notification alanından genelde zaten otomatik gösteriyor, bu yalnızca ek güvence
// (ör. bazı tarayıcı/OS kombinasyonlarında otomatik gösterim atlanabiliyor).
messaging.onBackgroundMessage((payload) => {
  const n = payload.notification || {};
  const link = payload.fcmOptions?.link || payload.data?.link || self.registration.scope;
  self.registration.showNotification(n.title || 'Teknohane', {
    body: n.body || '',
    icon: n.image || self.registration.scope + 'icons/icon-192.png',
    badge: self.registration.scope + 'icons/icon-96.png',
    data: { link }
  });
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const link = event.notification.data?.link || self.registration.scope;
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if ('focus' in client) { client.navigate(link).catch(() => {}); return client.focus(); }
      }
      if (clients.openWindow) return clients.openWindow(link);
    })
  );
});
