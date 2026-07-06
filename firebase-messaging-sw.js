// Bu dosya, uygulama kapalıyken/arka plandayken push bildirimlerinin gösterilmesini sağlar.
// Mevcut sw.js (önbellekleme için) ile ÇAKIŞMAZ — ayrı ve dar bir scope'ta çalışır.
importScripts('https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/9.23.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyADpIRNLQEIer_gplTgwKi_EKkfcyrYoqY",
  authDomain: "maasgunu-bd353.firebaseapp.com",
  projectId: "maasgunu-bd353",
  storageBucket: "maasgunu-bd353.firebasestorage.app",
  messagingSenderId: "485904329467",
  appId: "1:485904329467:web:579d932ae8f25958901e5e"
});

// firebase.messaging() çağrısı, tarayıcının push mesajlarını dinleyip
// bildirim (notification) alanı olan payload'ları otomatik göstermesini sağlar.
firebase.messaging();

// Bildirime tıklanınca ilgili sayfayı aç
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification?.data?.FCM_MSG?.notification?.click_action || 'https://teknohane.github.io/teknohane/';
  event.waitUntil(clients.openWindow(url));
});
