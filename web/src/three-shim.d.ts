/*
 * three ships no type declarations of its own and @types/three is not a dependency here (only
 * `three` was approved), so both entry points are typed loosely. Only Inventory3D uses them.
 */
declare module 'three';
declare module 'three/examples/jsm/controls/OrbitControls.js';
