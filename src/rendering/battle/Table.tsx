import { LAYOUT, PREP_SLOT_COUNT } from './layout';

/**
 * 战桌本体。
 *
 * `V-TABLE-1`：桌面要有可见细节，不是纯色平面；但不接受镜面反射
 * 导致卡面读不清，所以粗糙度调高、金属度归零。
 * `V-TABLE-2`：槽位边界低对比，只有可放置状态才提高对比（高亮由 SlotMarkers 负责）。
 *
 * 桌面的中心用 `LAYOUT.tableCenterZ`，**不是 0**：内容的分布本来就不对称
 * （敌方到 z≈-5.3，玩家手牌到 z≈+8.3），按 0 居中会一边留白一边被切。
 *
 * P1 先用程序几何与纯材质；HDRI / 石材贴图按 `V-TABLE-4` 在引入资源后替换，
 * 届时只需换 material，不用动布局。
 */
export function Table() {
  const playmatWidth = PREP_SLOT_COUNT * LAYOUT.prepSpacing + 1.6;
  const playmatDepth = LAYOUT.prepZ * 2 + 2.6;
  const z = LAYOUT.tableCenterZ;

  return (
    <group position={[0, 0, z]}>
      {/* 桌面主体：用 box 而不是 plane，这样侧沿厚度在斜视角下可见 */}
      <mesh receiveShadow position={[0, -LAYOUT.tableThickness / 2, 0]}>
        <boxGeometry
          args={[LAYOUT.tableWidth, LAYOUT.tableThickness, LAYOUT.tableDepth]}
        />
        <meshStandardMaterial color="#39414f" roughness={0.88} metalness={0.05} />
      </mesh>

      {/* 中央对战垫：很薄的一层，区分出有效区域 */}
      <mesh receiveShadow rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.004, 0]}>
        <planeGeometry args={[playmatWidth, playmatDepth]} />
        <meshStandardMaterial color="#474f61" roughness={0.95} metalness={0} />
      </mesh>

      {/* 中线：双方分界，低对比，不抢卡面注意力 */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.007, 0]}>
        <planeGeometry args={[playmatWidth, 0.018]} />
        <meshBasicMaterial color="#6b778f" />
      </mesh>
    </group>
  );
}
