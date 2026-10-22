import { Shape } from 'three';

/** A narrow slot with true semicircular ends, in XY before lying flat on XZ. */
export function abyssVitalsShape(width: number, length: number, x = 0, y = 0, segments = 1): Shape {
  const radius = width / 2, straight = Math.max(0, length / 2 - radius);
  const shape = new Shape();
  shape.moveTo(x - radius, y - straight);
  for (let step = 1; step <= segments; step++) shape.lineTo(x - radius, y - straight + 2 * straight * step / segments);
  shape.absarc(x, y + straight, radius, Math.PI, 0, true);
  for (let step = 1; step <= segments; step++) shape.lineTo(x + radius, y + straight - 2 * straight * step / segments);
  shape.absarc(x, y - straight, radius, 0, -Math.PI, true);
  shape.closePath();
  return shape;
}
