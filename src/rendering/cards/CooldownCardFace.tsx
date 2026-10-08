import { CARD_FACE_OFFSET } from './cardGeometry';

/** Procedural 3D clock and −1 glyph. No downloaded image or runtime font is needed. */
export function CooldownCardFace() {
  return <group position={[0, 0, CARD_FACE_OFFSET + 0.003]}>
    <mesh position={[0, 0.14, 0]}><ringGeometry args={[0.235, 0.265, 40]} />
      <meshBasicMaterial color="#ffd77d" toneMapped={false} /></mesh>
    {Array.from({ length: 12 }, (_, i) => {
      const angle = i / 12 * Math.PI * 2;
      return <mesh key={i} position={[Math.sin(angle) * 0.21, 0.14 + Math.cos(angle) * 0.21, 0.001]} rotation={[0, 0, -angle]}>
        <boxGeometry args={[0.012, 0.036, 0.004]} /><meshBasicMaterial color="#bff5ff" /></mesh>;
    })}
    <mesh position={[0, 0.205, 0.004]}><boxGeometry args={[0.022, 0.145, 0.009]} /><meshBasicMaterial color="#efffff" /></mesh>
    <mesh position={[0.047, 0.112, 0.006]} rotation={[0, 0, 1.02]}>
      <boxGeometry args={[0.021, 0.122, 0.009]} /><meshBasicMaterial color="#efffff" /></mesh>
    <mesh position={[-0.11, -0.36, 0]}><boxGeometry args={[0.16, 0.034, 0.009]} /><meshBasicMaterial color="#ffd77d" /></mesh>
    <mesh position={[0.12, -0.36, 0]}><boxGeometry args={[0.034, 0.25, 0.009]} /><meshBasicMaterial color="#ffd77d" /></mesh>
  </group>;
}
