// Logos de clientes com "peso visual" igual: usa a versão recortada (sem margem vazia, logo-*-t.webp) e
// calcula a altura pela área (logo largo fica mais baixo, logo quadrado mais alto).
import sizes from '../data/logo-sizes.json';

const AREA = 46 * 46 * 3.2; // área-alvo em px²
export function logoSize(src: string): { src: string; style: string } {
  const name = src.match(/logo-([a-z-]+)\.webp$/)?.[1];
  const s = name ? (sizes as Record<string, { w: number; h: number }>)[name] : undefined;
  if (!s) return { src, style: '' };
  const ar = s.w / s.h;
  let h = Math.min(68, Math.max(24, Math.sqrt(AREA / ar)));
  if (h * ar > 190) h = 190 / ar;
  return { src: `/images/logo-${name}-t.webp`, style: `height:${Math.round(h)}px;width:auto;max-height:none;max-width:100%` };
}
