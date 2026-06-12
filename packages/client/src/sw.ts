/// <reference lib="webworker" />
import { precacheAndRoute, cleanupOutdatedCaches } from 'workbox-precaching';

// The main tsconfig uses the DOM lib, so `self` is typed as Window here.
// Re-declare it as a ServiceWorkerGlobalScope so the SW APIs typecheck under
// the project's single tsconfig (vite-plugin-pwa compiles this file itself).
declare let self: ServiceWorkerGlobalScope & typeof globalThis;

// __WB_MANIFEST is injected by vite-plugin-pwa's injectManifest strategy.
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

// Activate the new SW immediately and take control of open clients without
// pulling in workbox-core (avoids an extra runtime dependency).
self.addEventListener('install', () => {
  void self.skipWaiting();
});

self.addEventListener('activate', (event: ExtendableEvent) => {
  event.waitUntil(self.clients.claim());
});

interface PushPayload {
  title: string;
  body?: string;
  url?: string;
}

function parsePush(event: PushEvent): PushPayload {
  try {
    const data = event.data?.json() as Partial<PushPayload> | undefined;
    if (data && typeof data.title === 'string') {
      return {
        title: data.title,
        body: typeof data.body === 'string' ? data.body : undefined,
        url: typeof data.url === 'string' ? data.url : undefined,
      };
    }
  } catch {
    /* malformed payload — fall through to default */
  }
  return { title: 'Задачи команды' };
}

self.addEventListener('push', (event: PushEvent) => {
  const payload = parsePush(event);
  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      lang: 'ru',
      data: { url: payload.url ?? '/' },
    }),
  );
});

self.addEventListener('notificationclick', (event: NotificationEvent) => {
  event.notification.close();
  const target = (event.notification.data as { url?: string } | undefined)?.url ?? '/';
  const targetUrl = new URL(target, self.location.origin);

  event.waitUntil(
    (async () => {
      const allClients = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      });
      for (const client of allClients) {
        if (new URL(client.url).origin === targetUrl.origin) {
          await client.focus();
          if ('navigate' in client) {
            await client.navigate(targetUrl.href).catch(() => undefined);
          }
          return;
        }
      }
      await self.clients.openWindow(targetUrl.href);
    })(),
  );
});
