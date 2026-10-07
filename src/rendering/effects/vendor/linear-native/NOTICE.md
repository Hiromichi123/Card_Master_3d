# Linear Ability Casting runtime subset

Source: https://github.com/achrefelouafi/LinearAbiltyCastingThreeJS
Commit: 97f1de19617e9a2e3af3c8021c8c21c8f58b40f3
License: MIT; see LICENSE.

Original Cinder Fall rock/fire/fissure materials and geometry, Glacial Crown glass/field/veil materials,
and Storm Lance core/halo materials are reused by NamedSkillVisuals.ts.
Only the module dependency closure is copied; no demo app, editor, input handlers or third-party network assets.
Adaptation: VFX layers use the game's default render layer; TypeScript declarations are added.
The game supplies its existing skill Timeline, camera, card-sized geometry, fallback depth/environment textures,
and resource cleanup. No battle rules or damage calculations are imported from the demo.

Glacial Crown refinement: GroundDecals.js is also reused for the shaded snow/rime foundation.
Ice is arranged in three crystal variants over the card face; glow controls are overridden per material.

Voltaic Snare cage/field shaders are reused for curse and a red ground-only injury variant.
Ice uses the reference frost decals along the cast route and locates card faces for surface snow.
Cinder Fall keeps molten cracks while hiding their raised charred lips and resting rock pile.
