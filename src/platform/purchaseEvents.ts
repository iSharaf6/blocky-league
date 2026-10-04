import { inNativeApp } from './native';

/** Definitive StoreKit failures, independent of Cordova's short-lived order monitor. */
export interface PurchaseRejection {
  id: string;
  productId: string;
  result: 'cancelled' | 'failed';
}

interface PurchaseEventsNative {
  addListener(name: 'rejected', listener: (event: PurchaseRejection) => void): Promise<{ remove(): Promise<void> }>;
  start(): Promise<void>;
  acknowledge(options: { id: string }): Promise<void>;
}

/** Native retains each event on disk until the save records it and this listener acknowledges it. */
export async function watchPurchaseRejections(accept: (event: PurchaseRejection) => boolean): Promise<void> {
  if (!inNativeApp()) return;
  try {
    const { registerPlugin } = await import('@capacitor/core');
    const plugin = registerPlugin<PurchaseEventsNative>('PurchaseEvents');
    await plugin.addListener('rejected', (event) => {
      try {
        if (accept(event)) void plugin.acknowledge({ id: event.id }).catch(() => {});
      } catch {
        // Leave the native disk receipt pending if saving failed.
      }
    });
    await plugin.start();
  } catch {
    // Older shells and Android use the normal purchase-provider callbacks.
  }
}
