import { api } from './api';

export type PushSupport = 'unsupported' | 'denied' | 'granted' | 'default';

/**
 * Result of attempting to establish a push subscription.
 * 'disabled' means push is supported but the server has no VAPID key configured.
 */
export type SubscribeResult = PushSupport | 'disabled';

/** Decode a base64url-encoded VAPID public key into the Uint8Array the Push API expects. */
function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const buffer = new ArrayBuffer(rawData.length);
  const output = new Uint8Array(buffer);
  for (let i = 0; i < rawData.length; i += 1) {
    output[i] = rawData.charCodeAt(i);
  }
  return output;
}

/** Report whether push is usable and, if so, the current Notification permission. */
export function getPushSupport(): PushSupport {
  const supported =
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window;
  if (!supported) return 'unsupported';
  return Notification.permission as PushSupport;
}

/**
 * Ensure an active push subscription exists and is registered with the server.
 * Call only when Notification permission is already 'granted'. Never throws to
 * the UI — failures are logged and surfaced via the return value.
 */
export async function ensurePushSubscription(): Promise<SubscribeResult> {
  const support = getPushSupport();
  if (support !== 'granted') return support;
  try {
    const { publicKey } = await api.vapidPublicKey();
    if (!publicKey) return 'disabled';

    const reg = await navigator.serviceWorker.ready;
    const existing = await reg.pushManager.getSubscription();
    const sub =
      existing ??
      (await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      }));

    const json = sub.toJSON();
    const keys = json.keys;
    if (!json.endpoint || !keys?.p256dh || !keys?.auth) {
      console.warn('Push subscription missing endpoint/keys');
      return 'granted';
    }
    await api.pushSubscribe({
      endpoint: json.endpoint,
      keys: { p256dh: keys.p256dh, auth: keys.auth },
    });
    return 'granted';
  } catch (err) {
    // iOS Safari (non-installed) rejects subscribe() with NotAllowedError;
    // treat any failure here as "push not available" without breaking the UI.
    console.warn('ensurePushSubscription failed', err);
    return 'unsupported';
  }
}

/**
 * Request Notification permission (must run from a user gesture for iOS) and,
 * if granted, establish the subscription. Returns the resulting state.
 */
export async function requestAndSubscribe(): Promise<SubscribeResult> {
  if (getPushSupport() === 'unsupported') return 'unsupported';
  try {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return permission as PushSupport;
    return ensurePushSubscription();
  } catch (err) {
    console.warn('requestAndSubscribe failed', err);
    return 'unsupported';
  }
}

/** Best-effort unsubscribe, used on logout. Never throws. */
export async function unsubscribePush(): Promise<void> {
  try {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (!sub) return;
    try {
      await api.pushUnsubscribe(sub.endpoint);
    } catch (err) {
      console.warn('pushUnsubscribe request failed', err);
    }
    await sub.unsubscribe();
  } catch (err) {
    console.warn('unsubscribePush failed', err);
  }
}
