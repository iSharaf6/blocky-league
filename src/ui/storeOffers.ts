import { FIRST_BUY_MULT, type IapProduct } from '../platform/iap';

/** Describe the actual pack. Local prices and per-pack first bonuses do not establish a universal best rate. */
export function gemPackBadge(product: Pick<IapProduct, 'firstBonus' | 'tag' | 'bonusPct'>): string {
  if (product.firstBonus) return `FIRST BUY X${FIRST_BUY_MULT}`;
  if (product.tag === 'BEST VALUE') return 'LARGEST PACK';
  if (product.tag === 'POPULAR' && product.bonusPct > 0) return 'BONUS GEMS';
  return '';
}
