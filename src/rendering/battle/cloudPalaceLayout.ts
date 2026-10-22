export interface PalaceIsland { readonly cluster: number; readonly x: number; readonly y: number; readonly z: number; readonly sy: number }
export interface CloudBuilding { readonly x: number; readonly y: number; readonly z: number; readonly scale: number; readonly yaw: number; readonly cluster?: number }
export function cloudBuildingLayout(islands: readonly PalaceIsland[]) {
  const halls: CloudBuilding[] = [{ x: -7.1, y: -.015, z: -1.7, scale: .58, yaw: Math.PI / 2 }];
  const towers: CloudBuilding[] = [];
  const gates: CloudBuilding[] = [{ x: 6.7, y: -.015, z: .8, scale: .72, yaw: -Math.PI / 2 }];
  for (const cloud of islands) {
    const i = cloud.cluster, pair = i % 2 === 0;
    const base = { x: cloud.x - (pair ? 1.65 : 0), y: cloud.y + cloud.sy * .72, z: cloud.z, scale: .95 + (i % 3) * .16, yaw: i * .7, cluster: i };
    (i % 4 === 0 ? gates : i % 3 === 0 ? halls : towers).push(base);
    if (pair) (i % 4 === 0 ? towers : halls).push({ ...base, x: cloud.x + 1.7, z: cloud.z + .45, scale: base.scale * .67, yaw: base.yaw + .5 });
  }
  return { halls, towers, gates };
}
