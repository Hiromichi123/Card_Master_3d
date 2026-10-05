import { useThree } from '@react-three/fiber';
import { useEffect } from 'react';
import { PMREMGenerator, type Texture, type WebGLRenderer } from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

import type { TableTheme } from '../table/themes';

/**
 * 场景环境与灯光。
 *
 * **移植自** `D:\Github\Chessboard-three.js`（MIT）的 `src/render/three/scene.js`
 * 的光照段。这套布置解决的是一个具体问题：台面材质用的是
 * `MeshPhysicalMaterial`，它带 `clearcoat`、`transmission`、`envMapIntensity`——
 * 而这些参数**只有在场景有环境贴图时才有意义**。没有 `scene.environment`，
 * 上漆的木头看起来就是一块平的褐色塑料，大理石与石材之间的差别也全丢了。
 *
 * 环境贴图是运行时由 `RoomEnvironment` 生成的，不需要下载 HDR 文件，
 * 生成一次后缓存在模块级——它只跟渲染器有关，跟主题无关。
 *
 * 灯是固定的三盏 + 一点环境光，主题只调**环境光强度**、背景与雾：
 * 换主题换的是场地氛围，不是重新打一次光。
 */

let cachedEnvironment: Texture | null = null;

function getRoomEnvironment(gl: WebGLRenderer): Texture {
  if (!cachedEnvironment) {
    const pmrem = new PMREMGenerator(gl);
    // 第二个参数是 sigma，越小越锐。0.04 保留一点柔化，避免反射里出现硬边。
    const target = pmrem.fromScene(new RoomEnvironment(), 0.04);
    cachedEnvironment = target.texture;
    pmrem.dispose();
  }
  return cachedEnvironment;
}

export interface SceneEnvironmentProps {
  readonly theme: TableTheme;
  readonly shadows: boolean;
}

export function SceneEnvironment({ theme, shadows }: SceneEnvironmentProps) {
  const gl = useThree((state) => state.gl);
  const scene = useThree((state) => state.scene);

  useEffect(() => {
    scene.environment = getRoomEnvironment(gl);
    return () => {
      // 只解绑，不销毁：纹理是跨场景共享的缓存
      scene.environment = null;
    };
  }, [gl, scene]);

  useEffect(() => {
    scene.environmentIntensity = theme.environmentIntensity;
  }, [scene, theme]);

  return (
    <>
      {/* 主光：唯一投影的光源。用平行光而不是聚光，阴影视锥就是一个盒子，
          整张桌子都在里面，不用为每张台面重算视锥。 */}
      <directionalLight
        color={0xfff4e6}
        intensity={1.35}
        position={[-11, 20, 9]}
        castShadow={shadows}
        shadow-mapSize-width={shadows ? 1024 : 512}
        shadow-mapSize-height={shadows ? 1024 : 512}
        shadow-camera-near={1}
        shadow-camera-far={60}
        shadow-camera-left={-13}
        shadow-camera-right={13}
        shadow-camera-top={13}
        shadow-camera-bottom={-13}
        // 法线偏移处理有弧度的卡牌边缘；只用普通 bias 要么阴影浮空、要么出现条纹
        shadow-bias={-0.0004}
        shadow-normalBias={0.03}
      />

      {/* 补光：对侧、偏冷、不投影。把暗部从背景里托起来。 */}
      <directionalLight color={0xbcd4ff} intensity={0.5} position={[13, 9, -11]} />

      {/* 轮廓光：低位后方，把主体边缘从背景里分出来。
          力度要克制——推猛了会把靠近镜头的一侧打出一条白边。 */}
      <pointLight color={0xffd9a0} intensity={14} distance={70} decay={2} position={[-4, 6, -19]} />

      <ambientLight intensity={0.1} />
    </>
  );
}

/** 供测试与调试查询环境贴图是否已生成。 */
export function hasSceneEnvironment(): boolean {
  return cachedEnvironment !== null;
}
