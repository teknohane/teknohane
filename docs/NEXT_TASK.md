# NEXT TASK

## Öncelik

Android donanım geri tuşu düzeltmesini tamamen doğrulamak.

## Yapılacaklar

1. @capacitor/app pluginının kurulu olduğunu doğrula.

2. Gerekirse:

npm install @capacitor/app

çalıştır.

3. Ardından:

npx cap sync android

çalıştır.

4. Android Studio'da Clean Project yap.

5. Yeni Signed AAB oluştur.

6. Google Play Internal Testing sürümünü yayınla.

7. Gerçek cihazda aşağıdaki senaryoları test et.

- Destek sayfası
- Mesajlar sayfası
- İlan detay ekranı
- Tam ekran görsel
- Ana ekran
- Çift basınca uygulamadan çıkış
