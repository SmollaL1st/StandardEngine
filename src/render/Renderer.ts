import { Vec3, lookAt, multiply, orthographic, transformPoint, type Mat4 } from '../core/math';
import type { RGB } from '../core/color';
import type { Geometry, ImageTexture, Mesh } from '../scene/Mesh';
import { depthFragment, depthVertex, mainFragment, mainVertex, postFragment, postVertex } from './shaders';

export interface DirectionalLight { dir: Vec3; color: RGB }
export interface LightRig {
    key: DirectionalLight;
    fill: DirectionalLight;
    rim: DirectionalLight;
    sky: RGB;
    ground: RGB;
    /** Angular radius of the key light, radians: larger gives softer shadows. */
    lightRadius: number;
    shadows: boolean;
    exposure: number;
}

export interface Frame {
    meshes: Mesh[];
    viewProj: Mat4;
    eye: Vec3;
    rig: LightRig;
    /** World-space box around everything that casts a shadow. */
    casterBounds: { min: Vec3; max: Vec3 };
    /** Footprint for contact shading: x, z, radius, strength. */
    contact: [number, number, number, number];
    catcherOpacity: number;
    clear: [number, number, number, number];
    /** Draw only shadow receivers (for a separate shadow layer). */
    receiversOnly?: boolean;
    /** Anime style: cel shading plus ink outlines `line` pixels wide. */
    toon?: { line: number; nearFar: [number, number] } | null;
}

export interface Target { framebuffer: WebGLFramebuffer | null; width: number; height: number }

type Buffers = { vao: WebGLVertexArrayObject; buffers: (WebGLBuffer | null)[]; revision: number; layout: number; count: number };
type ToonTargets = {
    width: number; height: number; msaa: WebGLFramebuffer; resolve: WebGLFramebuffer;
    renderbuffers: WebGLRenderbuffer[]; color: WebGLTexture; ink: WebGLTexture; depth: WebGLTexture;
};
const TYPES = { cloth: 0, metal: 1, lacquer: 2, strand: 3, floor: 4, catcher: 5 } as const;
const UNIFORMS = ['uViewProj', 'uModel', 'uType', 'uBase', 'uRough', 'uSpec', 'uSheen', 'uAniso', 'uTrans', 'uWeave', 'uGrain',
    'uStripes', 'uSize', 'uTextured', 'uTex', 'uShadow', 'uShadowDepth', 'uLightVP', 'uShadowInfo', 'uShadowExtent', 'uEye',
    'uKeyDir', 'uKeyCol', 'uFillDir', 'uFillCol', 'uRimDir', 'uRimCol', 'uSky', 'uGround', 'uExposure', 'uContact', 'uCatcherOpacity',
    'uFlipU', 'uToon', 'uInk'];
const INK = { cloth: 1, metal: 1, lacquer: 1, strand: 0, floor: 0, catcher: 0 } as const;

/** Mirrored model matrices reverse triangle winding. */
const mirrored = (m: Mat4) => m[0] * (m[5] * m[10] - m[6] * m[9]) - m[4] * (m[1] * m[10] - m[2] * m[9]) + m[8] * (m[1] * m[6] - m[2] * m[5]) < 0;

/** WebGL 2 renderer: PCSS key-light shadows, textile / metal / lacquer / cord shading, MSAA export targets. */
export class Renderer {
    readonly gl: WebGL2RenderingContext;
    readonly canvas: HTMLCanvasElement;
    readonly maxSamples: number;
    readonly maxTexture: number;
    private program!: WebGLProgram;
    private depthProgram!: WebGLProgram;
    private postProgram!: WebGLProgram;
    private postVao!: WebGLVertexArrayObject;
    private pu: Record<string, WebGLUniformLocation | null> = {};
    private toonTargets: ToonTargets | null = null;
    private u: Record<string, WebGLUniformLocation | null> = {};
    private du: Record<string, WebGLUniformLocation | null> = {};
    private readonly meshes = new Map<Geometry, Buffers>();
    private readonly textures = new Map<ImageTexture, WebGLTexture>();
    private shadowTexture!: WebGLTexture;
    private shadowFramebuffer!: WebGLFramebuffer;
    private compareSampler!: WebGLSampler;
    private rawSampler!: WebGLSampler;
    private white!: WebGLTexture;
    private anisotropy: EXT_texture_filter_anisotropic | null = null;
    private shadowSize = 2048;
    private lightVP: Mat4 = new Float32Array(16);
    private shadowExtent: [number, number] = [1, 1];
    private shadowDepth = 1;
    private lost = false;

    constructor(canvas: HTMLCanvasElement) {
        const gl = canvas.getContext('webgl2', { antialias: true, alpha: true, premultipliedAlpha: true, preserveDrawingBuffer: false });
        if (!gl) throw new Error('Нужен браузер с поддержкой WebGL 2.');
        this.gl = gl; this.canvas = canvas;
        this.maxSamples = gl.getParameter(gl.MAX_SAMPLES) as number;
        this.maxTexture = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
        this.initialize();
        canvas.addEventListener('webglcontextlost', this.onLost);
        canvas.addEventListener('webglcontextrestored', this.onRestored);
    }

    private compile(vertex: string, fragment: string) {
        const gl = this.gl, program = gl.createProgram()!;
        for (const [type, source] of [[gl.VERTEX_SHADER, vertex], [gl.FRAGMENT_SHADER, fragment]] as const) {
            const shader = gl.createShader(type)!;
            gl.shaderSource(shader, source); gl.compileShader(shader);
            if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
                const log = gl.getShaderInfoLog(shader); gl.deleteShader(shader); gl.deleteProgram(program);
                throw new Error(`Shader compilation failed: ${log}`);
            }
            gl.attachShader(program, shader); gl.deleteShader(shader);
        }
        gl.linkProgram(program);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
            const log = gl.getProgramInfoLog(program); gl.deleteProgram(program);
            throw new Error(`Shader linking failed: ${log}`);
        }
        return program;
    }

    private initialize() {
        const gl = this.gl;
        this.program = this.compile(mainVertex, mainFragment);
        this.depthProgram = this.compile(depthVertex, depthFragment);
        this.postProgram = this.compile(postVertex, postFragment);
        this.postVao = gl.createVertexArray()!;
        this.toonTargets = null;
        for (const name of UNIFORMS) this.u[name] = gl.getUniformLocation(this.program, name);
        for (const name of ['uViewProj', 'uModel', 'uTex', 'uTextured', 'uFlipU']) this.du[name] = gl.getUniformLocation(this.depthProgram, name);
        for (const name of ['uColor', 'uInkMask', 'uDepth', 'uTexel', 'uLine', 'uNearFar', 'uInkColor', 'uSaturation']) {
            this.pu[name] = gl.getUniformLocation(this.postProgram, name);
        }
        this.anisotropy = gl.getExtension('EXT_texture_filter_anisotropic');
        this.shadowSize = this.maxTexture >= 8192 ? 4096 : 2048;
        this.white = gl.createTexture()!;
        gl.bindTexture(gl.TEXTURE_2D, this.white);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255, 255, 255, 255]));
        this.shadowTexture = gl.createTexture()!;
        gl.bindTexture(gl.TEXTURE_2D, this.shadowTexture);
        gl.texStorage2D(gl.TEXTURE_2D, 1, gl.DEPTH_COMPONENT24, this.shadowSize, this.shadowSize);
        this.shadowFramebuffer = gl.createFramebuffer()!;
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadowFramebuffer);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, this.shadowTexture, 0);
        gl.drawBuffers([gl.NONE]); gl.readBuffer(gl.NONE);
        if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('Shadow framebuffer is incomplete.');
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        this.compareSampler = gl.createSampler()!;
        for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE],
            [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE], [gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE], [gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL]]) {
            gl.samplerParameteri(this.compareSampler, k, v);
        }
        this.rawSampler = gl.createSampler()!;
        for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.NEAREST], [gl.TEXTURE_MAG_FILTER, gl.NEAREST], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE],
            [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE], [gl.TEXTURE_COMPARE_MODE, gl.NONE]]) {
            gl.samplerParameteri(this.rawSampler, k, v);
        }
        gl.enable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE);
    }

    /** Resizes the canvas backing store to its CSS size; returns the drawing target. */
    canvasTarget(pixelRatio = Math.min(window.devicePixelRatio || 1, 2)): Target {
        const width = Math.max(1, Math.round(this.canvas.clientWidth * pixelRatio));
        const height = Math.max(1, Math.round(this.canvas.clientHeight * pixelRatio));
        if (this.canvas.width !== width || this.canvas.height !== height) { this.canvas.width = width; this.canvas.height = height; }
        return { framebuffer: null, width, height };
    }

    private sync(geometry: Geometry) {
        const gl = this.gl;
        let res = this.meshes.get(geometry);
        if (res && res.layout !== geometry.layout) {
            res.buffers.forEach(b => b && gl.deleteBuffer(b)); gl.deleteVertexArray(res.vao);
            this.meshes.delete(geometry); res = undefined;
        }
        if (!res) {
            res = { vao: gl.createVertexArray()!, buffers: [], revision: geometry.revision, layout: geometry.layout, count: geometry.indices.length };
            gl.bindVertexArray(res.vao);
            const attributes: [number, Float32Array | null, number][] = [
                [0, geometry.positions, 3], [1, geometry.normals, 3], [2, geometry.uvs, 2], [3, geometry.tangents, 3], [4, geometry.ao, 2]];
            for (const [location, data, size] of attributes) {
                if (!data || data.length === 0) {
                    res.buffers.push(null); gl.disableVertexAttribArray(location);
                    continue;
                }
                const buffer = gl.createBuffer()!; res.buffers.push(buffer);
                gl.bindBuffer(gl.ARRAY_BUFFER, buffer); gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
                gl.enableVertexAttribArray(location); gl.vertexAttribPointer(location, size, gl.FLOAT, false, 0, 0);
            }
            const index = gl.createBuffer()!; res.buffers.push(index);
            gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, index); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, geometry.indices, gl.STATIC_DRAW);
            this.meshes.set(geometry, res);
        } else {
            gl.bindVertexArray(res.vao);
            if (res.revision !== geometry.revision) {
                const data = [geometry.positions, geometry.normals, geometry.uvs, geometry.tangents, geometry.ao];
                data.forEach((values, i) => {
                    const buffer = res!.buffers[i];
                    if (!buffer || !values) return;
                    gl.bindBuffer(gl.ARRAY_BUFFER, buffer); gl.bufferSubData(gl.ARRAY_BUFFER, 0, values);
                });
                res.revision = geometry.revision;
            }
        }
        // Constant attribute values for meshes without tangents or occlusion.
        if (!res.buffers[3]) gl.vertexAttrib3f(3, 1, 0, 0);
        if (!res.buffers[4]) gl.vertexAttrib2f(4, 0, 0);
        return res;
    }

    private texture(asset: ImageTexture | null) {
        if (!asset || asset.disposed) return this.white;
        const existing = this.textures.get(asset);
        if (existing) return existing;
        const gl = this.gl, texture = gl.createTexture()!;
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
        gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
        // sRGB storage: filtering and mipmaps happen in linear light.
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.SRGB8_ALPHA8, gl.RGBA, gl.UNSIGNED_BYTE, asset.source);
        gl.generateMipmap(gl.TEXTURE_2D);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        if (this.anisotropy) gl.texParameterf(gl.TEXTURE_2D, this.anisotropy.TEXTURE_MAX_ANISOTROPY_EXT,
            Math.min(16, gl.getParameter(this.anisotropy.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        this.textures.set(asset, texture);
        return texture;
    }

    /** Fits the key-light frustum around the casters and their shadows on the floor. */
    private fitShadow(frame: Frame) {
        const L = frame.rig.key.dir, { min, max } = frame.casterBounds;
        const points: Vec3[] = [];
        for (const x of [min.x, max.x]) for (const y of [min.y, max.y]) for (const z of [min.z, max.z]) {
            points.push(new Vec3(x, y, z));
            if (L.y > 0.05) {
                const t = Math.min(y / L.y, 14);
                points.push(new Vec3(x - L.x * t, 0, z - L.z * t));
            }
        }
        const centre = new Vec3().lerpVectors(min, max, 0.5);
        const radius = min.distanceTo(max) / 2 + 1;
        const view = lookAt(centre.clone().addScaled(L, radius * 4), centre);
        const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity], out = new Float64Array(4);
        for (const p of points) {
            transformPoint(view, p.x, p.y, p.z, out);
            for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], out[k]); hi[k] = Math.max(hi[k], out[k]); }
        }
        const pad = Math.max(hi[0] - lo[0], hi[1] - lo[1]) * 0.03 + 0.05;
        const near = -hi[2] - pad * 4, far = -lo[2] + pad * 4;
        this.lightVP = multiply(orthographic(lo[0] - pad, hi[0] + pad, lo[1] - pad, hi[1] + pad, near, far), view);
        this.shadowExtent = [hi[0] - lo[0] + pad * 2, hi[1] - lo[1] + pad * 2];
        this.shadowDepth = far - near;
    }

    /** Renders the key-light depth map. Call once per frame, or once per export. */
    renderShadows(frame: Frame) {
        if (this.lost) return;
        const gl = this.gl;
        this.release();
        this.fitShadow(frame);
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadowFramebuffer);
        gl.viewport(0, 0, this.shadowSize, this.shadowSize);
        gl.clear(gl.DEPTH_BUFFER_BIT);
        if (!frame.rig.shadows) return;
        gl.useProgram(this.depthProgram);
        gl.disable(gl.BLEND);
        gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(1.2, 2.0);
        gl.uniformMatrix4fv(this.du.uViewProj, false, this.lightVP);
        gl.uniform1i(this.du.uTex, 0);
        for (const mesh of frame.meshes) {
            if (!mesh.visible || !mesh.castShadow || mesh.geometry.disposed || !mesh.geometry.indices.length) continue;
            gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.texture(mesh.material.texture));
            gl.uniform1f(this.du.uTextured, mesh.material.texture ? 1 : 0);
            gl.uniform1f(this.du.uFlipU, mesh.material.flipU ? 1 : 0);
            gl.uniformMatrix4fv(this.du.uModel, false, mesh.model);
            const res = this.sync(mesh.geometry);
            gl.drawElements(gl.TRIANGLES, res.count, gl.UNSIGNED_INT, 0);
        }
        gl.disable(gl.POLYGON_OFFSET_FILL);
        gl.bindVertexArray(null);
    }

    draw(frame: Frame, target: Target) {
        if (this.lost) return;
        if (frame.toon) this.drawToon(frame, target);
        else this.drawScene(frame, target, false);
    }

    private drawScene(frame: Frame, target: Target, toon: boolean) {
        const gl = this.gl, u = this.u, rig = frame.rig;
        gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
        gl.viewport(0, 0, target.width, target.height);
        gl.depthMask(true);
        if (toon) {
            gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
            gl.clearBufferfv(gl.COLOR, 0, frame.clear);
            gl.clearBufferfv(gl.COLOR, 1, [0, 0, 0, 0]);
            gl.clear(gl.DEPTH_BUFFER_BIT);
        } else {
            gl.clearColor(...frame.clear);
            gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        }
        gl.useProgram(this.program);
        gl.uniform1f(u.uToon, toon ? 1 : 0);
        gl.uniformMatrix4fv(u.uViewProj, false, frame.viewProj);
        gl.uniformMatrix4fv(u.uLightVP, false, this.lightVP);
        gl.uniform4f(u.uShadowInfo, this.shadowDepth, Math.tan(rig.lightRadius), 1 / this.shadowSize, rig.shadows ? 1 : 0);
        gl.uniform2f(u.uShadowExtent, this.shadowExtent[0], this.shadowExtent[1]);
        gl.uniform3f(u.uEye, frame.eye.x, frame.eye.y, frame.eye.z);
        for (const [name, light] of [['Key', rig.key], ['Fill', rig.fill], ['Rim', rig.rim]] as const) {
            gl.uniform3f(u[`u${name}Dir`], light.dir.x, light.dir.y, light.dir.z);
            gl.uniform3fv(u[`u${name}Col`], light.color);
        }
        gl.uniform3fv(u.uSky, rig.sky); gl.uniform3fv(u.uGround, rig.ground);
        gl.uniform1f(u.uExposure, rig.exposure);
        gl.uniform4fv(u.uContact, frame.contact);
        gl.uniform1f(u.uCatcherOpacity, frame.catcherOpacity);
        gl.uniform1i(u.uTex, 0); gl.uniform1i(u.uShadow, 1); gl.uniform1i(u.uShadowDepth, 2);
        gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.shadowTexture); gl.bindSampler(1, this.compareSampler);
        gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, this.shadowTexture); gl.bindSampler(2, this.rawSampler);
        for (const mesh of frame.meshes) {
            if (!mesh.visible || mesh.geometry.disposed || !mesh.geometry.indices.length) continue;
            const m = mesh.material, receiver = m.type === 'floor' || m.type === 'catcher';
            if (frame.receiversOnly && !receiver) continue;
            const blended = m.type === 'catcher';
            if (blended) { gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false); }
            else { gl.disable(gl.BLEND); gl.depthMask(true); }
            gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.texture(m.texture));
            gl.uniformMatrix4fv(u.uModel, false, mesh.model);
            gl.uniform1i(u.uType, TYPES[m.type]);
            gl.uniform3fv(u.uBase, m.color);
            gl.uniform1f(u.uRough, m.roughness); gl.uniform1f(u.uSpec, m.specular); gl.uniform1f(u.uSheen, m.sheen);
            gl.uniform1f(u.uAniso, m.anisotropy); gl.uniform1f(u.uTrans, m.translucency); gl.uniform1f(u.uWeave, m.weave);
            gl.uniform1f(u.uGrain, m.grain); gl.uniform2fv(u.uStripes, m.stripes); gl.uniform2fv(u.uSize, m.size);
            gl.uniform1f(u.uTextured, m.texture ? 1 : 0);
            gl.uniform1f(u.uFlipU, m.flipU ? 1 : 0);
            gl.uniform1f(u.uInk, INK[m.type]);
            gl.frontFace(mirrored(mesh.model) ? gl.CW : gl.CCW);
            const res = this.sync(mesh.geometry);
            gl.drawElements(gl.TRIANGLES, res.count, gl.UNSIGNED_INT, 0);
        }
        gl.frontFace(gl.CCW);
        gl.disable(gl.BLEND); gl.depthMask(true);
        gl.bindSampler(1, null); gl.bindSampler(2, null);
        gl.bindVertexArray(null);
    }

    /** Multisampled scene buffers (colour + ink mask + depth) and their single-sample copies. */
    private toonBuffers(width: number, height: number) {
        const gl = this.gl, old = this.toonTargets;
        if (old && old.width === width && old.height === height) return old;
        if (old) this.releaseToon();
        const samples = Math.min(4, this.maxSamples);
        const rb = (format: number) => {
            const r = gl.createRenderbuffer()!;
            gl.bindRenderbuffer(gl.RENDERBUFFER, r);
            gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, format, width, height);
            return r;
        };
        const tex = (internal: number, format: number, type: number) => {
            const t = gl.createTexture()!;
            gl.bindTexture(gl.TEXTURE_2D, t);
            gl.texImage2D(gl.TEXTURE_2D, 0, internal, width, height, 0, format, type, null);
            for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.NEAREST], [gl.TEXTURE_MAG_FILTER, gl.NEAREST],
                [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
            return t;
        };
        const renderbuffers = [rb(gl.RGBA8), rb(gl.R8), rb(gl.DEPTH_COMPONENT24)];
        const msaa = gl.createFramebuffer()!;
        gl.bindFramebuffer(gl.FRAMEBUFFER, msaa);
        gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, renderbuffers[0]);
        gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.RENDERBUFFER, renderbuffers[1]);
        gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, renderbuffers[2]);
        const color = tex(gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE), ink = tex(gl.R8, gl.RED, gl.UNSIGNED_BYTE);
        const depth = tex(gl.DEPTH_COMPONENT24, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT);
        const resolve = gl.createFramebuffer()!;
        gl.bindFramebuffer(gl.FRAMEBUFFER, resolve);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, color, 0);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, ink, 0);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, depth, 0);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        this.toonTargets = { width, height, msaa, resolve, renderbuffers, color, ink, depth };
        return this.toonTargets;
    }

    private releaseToon() {
        const gl = this.gl, t = this.toonTargets;
        if (!t) return;
        gl.deleteFramebuffer(t.msaa); gl.deleteFramebuffer(t.resolve);
        t.renderbuffers.forEach(r => gl.deleteRenderbuffer(r));
        gl.deleteTexture(t.color); gl.deleteTexture(t.ink); gl.deleteTexture(t.depth);
        this.toonTargets = null;
    }

    /** Anime style: cel-shaded scene, then ink lines where depth breaks. */
    private drawToon(frame: Frame, target: Target) {
        const gl = this.gl, w = target.width, h = target.height, t = this.toonBuffers(w, h), toon = frame.toon!;
        this.drawScene(frame, { framebuffer: t.msaa, width: w, height: h }, true);
        gl.bindFramebuffer(gl.READ_FRAMEBUFFER, t.msaa);
        gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, t.resolve);
        gl.readBuffer(gl.COLOR_ATTACHMENT0); gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.NONE]);
        gl.blitFramebuffer(0, 0, w, h, 0, 0, w, h, gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT, gl.NEAREST);
        gl.readBuffer(gl.COLOR_ATTACHMENT1); gl.drawBuffers([gl.NONE, gl.COLOR_ATTACHMENT1]);
        gl.blitFramebuffer(0, 0, w, h, 0, 0, w, h, gl.COLOR_BUFFER_BIT, gl.NEAREST);
        gl.readBuffer(gl.COLOR_ATTACHMENT0);
        gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
        if (target.framebuffer) gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
        gl.viewport(0, 0, w, h);
        gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND);
        gl.useProgram(this.postProgram);
        const units: [string, WebGLTexture][] = [['uColor', t.color], ['uInkMask', t.ink], ['uDepth', t.depth]];
        units.forEach(([name, texture], i) => {
            gl.activeTexture(gl.TEXTURE3 + i); gl.bindTexture(gl.TEXTURE_2D, texture); gl.uniform1i(this.pu[name], 3 + i);
        });
        gl.uniform2f(this.pu.uTexel, 1 / w, 1 / h);
        gl.uniform1f(this.pu.uLine, Math.max(0.5, toon.line));
        gl.uniform2f(this.pu.uNearFar, toon.nearFar[0], toon.nearFar[1]);
        gl.uniform3f(this.pu.uInkColor, 0.035, 0.03, 0.045);
        gl.uniform1f(this.pu.uSaturation, 1.12);
        gl.bindVertexArray(this.postVao);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        gl.bindVertexArray(null);
        gl.enable(gl.DEPTH_TEST);
    }

    /** Renders into a multisampled target and returns premultiplied RGBA rows, bottom row first. */
    /**
     * Renders `width + 2·margin` square pixels and returns the inner `width × height`
     * as premultiplied RGBA rows, bottom row first. The margin gives outline filters
     * their neighbours at tile borders.
     */
    drawToPixels(frame: Frame, width: number, height: number, samples: number, margin = 0) {
        const gl = this.gl, fullW = width + margin * 2, fullH = height + margin * 2;
        const msaa = gl.createFramebuffer()!, resolve = gl.createFramebuffer()!;
        const color = gl.createRenderbuffer()!, depth = gl.createRenderbuffer()!, plain = gl.createRenderbuffer()!;
        try {
            gl.bindRenderbuffer(gl.RENDERBUFFER, plain);
            gl.renderbufferStorage(gl.RENDERBUFFER, gl.RGBA8, fullW, fullH);
            gl.bindFramebuffer(gl.FRAMEBUFFER, resolve);
            gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, plain);
            if (frame.toon) {
                this.drawToon(frame, { framebuffer: resolve, width: fullW, height: fullH });
            } else {
                const count = Math.max(0, Math.min(samples, this.maxSamples));
                gl.bindRenderbuffer(gl.RENDERBUFFER, color);
                gl.renderbufferStorageMultisample(gl.RENDERBUFFER, count, gl.RGBA8, fullW, fullH);
                gl.bindRenderbuffer(gl.RENDERBUFFER, depth);
                gl.renderbufferStorageMultisample(gl.RENDERBUFFER, count, gl.DEPTH_COMPONENT24, fullW, fullH);
                gl.bindFramebuffer(gl.FRAMEBUFFER, msaa);
                gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, color);
                gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth);
                if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('Не удалось создать буфер экспорта.');
                this.drawScene(frame, { framebuffer: msaa, width: fullW, height: fullH }, false);
                gl.bindFramebuffer(gl.READ_FRAMEBUFFER, msaa);
                gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, resolve);
                gl.blitFramebuffer(0, 0, fullW, fullH, 0, 0, fullW, fullH, gl.COLOR_BUFFER_BIT, gl.NEAREST);
            }
            gl.bindFramebuffer(gl.FRAMEBUFFER, resolve);
            const pixels = new Uint8Array(width * height * 4);
            gl.readPixels(margin, margin, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
            return pixels;
        } finally {
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
            gl.deleteFramebuffer(msaa); gl.deleteFramebuffer(resolve);
            gl.deleteRenderbuffer(color); gl.deleteRenderbuffer(depth); gl.deleteRenderbuffer(plain);
        }
    }

    private release() {
        const gl = this.gl;
        for (const [geometry, res] of this.meshes) if (geometry.disposed) {
            res.buffers.forEach(b => b && gl.deleteBuffer(b)); gl.deleteVertexArray(res.vao); this.meshes.delete(geometry);
        }
        for (const [asset, texture] of this.textures) if (asset.disposed) { gl.deleteTexture(texture); this.textures.delete(asset); }
    }

    get isLost() { return this.lost; }

    private onLost = (event: Event) => { event.preventDefault(); this.lost = true; };
    private onRestored = () => {
        this.meshes.clear(); this.textures.clear(); this.toonTargets = null;
        try { this.initialize(); this.lost = false; }
        catch (error) { this.canvas.dispatchEvent(new CustomEvent('rendererror', { detail: String(error) })); }
    };

    dispose() {
        this.canvas.removeEventListener('webglcontextlost', this.onLost);
        this.canvas.removeEventListener('webglcontextrestored', this.onRestored);
        const gl = this.gl;
        for (const res of this.meshes.values()) { res.buffers.forEach(b => b && gl.deleteBuffer(b)); gl.deleteVertexArray(res.vao); }
        for (const texture of this.textures.values()) gl.deleteTexture(texture);
        gl.deleteTexture(this.white); gl.deleteTexture(this.shadowTexture); gl.deleteFramebuffer(this.shadowFramebuffer);
        gl.deleteSampler(this.compareSampler); gl.deleteSampler(this.rawSampler);
        this.releaseToon();
        gl.deleteProgram(this.program); gl.deleteProgram(this.depthProgram); gl.deleteProgram(this.postProgram);
        gl.deleteVertexArray(this.postVao);
        this.meshes.clear(); this.textures.clear();
    }
}
