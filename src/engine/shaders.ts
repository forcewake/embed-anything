/**
 * The GLSL sources of the glass field.
 *
 * These are the *actual* shader strings extracted from the reference bundle
 * (`Ue` and `We` in `frontend.renderer.extracted.js`), kept byte-equivalent in
 * `glass.vert.glsl` and `glass.frag.glsl`.
 */
import vertexSource from './shaders/glass.vert.glsl?raw';
import fragmentSource from './shaders/glass.frag.glsl?raw';

export const VERTEX_SHADER = vertexSource;
export const FRAGMENT_SHADER = fragmentSource;
