// Logos de clientes com "peso visual" igual: usa a versão recortada (sem margem vazia, logo-*-t.webp) e
// calcula a altura pela área (logo largo fica mais baixo, logo quadrado mais alto).
import sizes from '../data/logo-sizes.json';

const AREA = 46 * 46 * 3.2; // área-alvo em px² (escala 1 = faixa de logos; os cards de case usam uma escala maior)
export function logoSize(src: string, scale = 1): { src: string; style: string } {
  const name = src.match(/logo-([a-z-]+)\.webp$/)?.[1];
  // boost: ajuste opcional de peso visual (logo de traço fino ou cor clara precisa de mais área para "pesar" igual)
  const s = name ? (sizes as Record<string, { w: number; h: number; boost?: number }>)[name] : undefined;
  if (!s) return { src, style: '' };
  const ar = s.w / s.h;
  scale *= s.boost ?? 1;
  let h = Math.min(68 * scale, Math.max(24 * scale, Math.sqrt(AREA / ar) * scale));
  if (h * ar > 190 * scale) h = (190 * scale) / ar;
  return { src: `/images/logo-${name}-t.webp`, style: `height:${Math.round(h)}px;width:auto;max-height:none;max-width:100%` };
}
