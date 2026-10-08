import { Geometry, ImageTexture, RenderMesh } from './Geometry';
import { Camera } from './Camera';
import { Vec3, lookAt, multiply4, orthographic } from './math';

const vertexSource = `#version 300 es
precision highp float;
layout(location=0) in vec3 aPosition;
layout(location=1) in vec3 aNormal;
layout(location=2) in vec2 aUV;
uniform mat4 uViewProjection;
uniform mat4 uLightProjection;
out vec3 vPosition;
out vec3 vNormal;
out vec2 vUV;
out vec4 vShadow;
void main() {
    vPosition=aPosition; vNormal=aNormal; vUV=aUV;
    vShadow=uLightProjection*vec4(aPosition,1.0);
    gl_Position=uViewProjection*vec4(aPosition,1.0);
}`;
const fragmentSource = `#version 300 es
precision highp float;
in vec3 vPosition;
in vec3 vNormal;
in vec2 vUV;
in vec4 vShadow;
uniform sampler2D uImage;
uniform sampler2D uShadow;
uniform vec3 uColor;
uniform vec3 uEye;
uniform vec3 uLight;
uniform float uSheen;
uniform float uTextured;
uniform float uToon;
uniform int uKind;
out vec4 outColor;
float shadow(vec3 n) {
    vec3 p=vShadow.xyz/vShadow.w*0.5+0.5;
    if(p.x<0.0||p.x>1.0||p.y<0.0||p.y>1.0||p.z>1.0||p.z<0.0) return 1.0;
    float bias=max(0.00035,0.0012*(1.0-abs(dot(n,uLight))));
    float result=0.0;
    vec2 texel=1.0/vec2(textureSize(uShadow,0));
    for(int x=-1;x<=1;x++) for(int y=-1;y<=1;y++) {
        float depth=texture(uShadow,p.xy+vec2(float(x),float(y))*texel*1.5).r;
        result+=p.z-bias>depth?0.0:1.0;
    }
    return result/9.0;
}
void main() {
    vec3 n=normalize(vNormal);
    if(!gl_FrontFacing) n=-n;
    vec3 view=normalize(uEye-vPosition);
    vec3 base=pow(uColor,vec3(2.2));
    if(uTextured>0.5) {
        vec4 tex=texture(uImage,vUV);
        if(tex.a<0.02) discard;
        base*=pow(tex.rgb,vec3(2.2));
    }
    float facing=max(0.0,dot(n,uLight));
    float visibility=shadow(n);
    vec3 rim=normalize(vec3(0.65,0.35,-0.7));
    float ambient=0.38+0.1*(n.y*0.5+0.5);
    float diffuse=facing*visibility;
    if(uToon>0.5) diffuse=diffuse<0.25?0.05:(diffuse<0.65?0.4:0.9);
    vec3 light=vec3(ambient)+vec3(1.0,0.95,0.86)*diffuse*0.8
        +vec3(0.75,0.83,1.0)*max(0.0,dot(n,rim))*0.18;
    vec3 color=base*light;
    vec3 halfVector=normalize(view+uLight);
    if(uKind==0 && uToon<0.5) {
        // Silk sheen follows the cloth normal; the printed image keeps its UV metric.
        float grazing=pow(1.0-abs(dot(n,view)),3.0);
        float spec=pow(max(0.0,dot(n,halfVector)),28.0);
        color+=vec3(0.32,0.3,0.25)*uSheen*(grazing*0.3+spec*0.7)*visibility;
        float weave=sin(vUV.x*2000.0)*sin(vUV.y*2000.0);
        float aa=1.0-smoothstep(0.001,0.006,max(fwidth(vUV.x),fwidth(vUV.y)));
        color*=1.0+weave*0.018*aa;
    } else if(uKind==1) {
        float spec=pow(max(0.0,dot(n,halfVector)),55.0);
        float studio=pow(max(0.0,dot(n,normalize(vec3(-0.5,0.8,0.4)))),10.0);
        color=base*(0.4+diffuse*0.5+studio*0.6)+vec3(1.0,0.85,0.45)*spec*visibility*0.8;
    } else if(uKind==2) {
        color*=0.94+0.06*sin(vPosition.y*110.0+sin(vPosition.z*130.0));
    } else if(uKind==3) {
        color+=vec3(pow(max(0.0,dot(n,halfVector)),60.0)*0.12);
    }
    // Linear illumination, then display encoding. No projection-dependent UV correction.
    color=color/(vec3(1.0)+color*0.18);
    outColor=vec4(pow(max(color,vec3(0.0)),vec3(1.0/2.2)),1.0);
}`;
const depthVertex = `#version 300 es
layout(location=0) in vec3 aPosition;
layout(location=2) in vec2 aUV;
uniform mat4 uViewProjection;
out vec2 vUV;
void main(){vUV=aUV;gl_Position=uViewProjection*vec4(aPosition,1.0);}`;
const depthFragment = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D uImage;
uniform float uTextured;
void main(){if(uTextured>0.5 && texture(uImage,vUV).a<0.02) discard;}`;

type MeshBuffers = { vao: WebGLVertexArrayObject; buffers: WebGLBuffer[]; revision: number };
type Anisotropy = { TEXTURE_MAX_ANISOTROPY_EXT: number; MAX_TEXTURE_MAX_ANISOTROPY_EXT: number };

/** Direct WebGL2 renderer: mesh buffers, GLSL silk/metal shading and depth-map shadows. */
export class Renderer {
    readonly gl: WebGL2RenderingContext;
    readonly camera: Camera;
    private readonly canvas: HTMLCanvasElement;
    private readonly meshes = new Map<Geometry, MeshBuffers>();
    private readonly textures = new Map<ImageTexture, WebGLTexture>();
    private program!: WebGLProgram;
    private depthProgram!: WebGLProgram;
    private uniforms: Record<string, WebGLUniformLocation | null> = {};
    private depthUniforms: Record<string, WebGLUniformLocation | null> = {};
    private shadowTexture!: WebGLTexture;
    private shadowBuffer!: WebGLFramebuffer;
    private whiteTexture!: WebGLTexture;
    private anisotropy: Anisotropy | null = null;
    private lost = false;
    private shadowSize = 2048;
    private readonly light = new Vec3(-0.36, 0.76, 0.54).normalize();

    constructor(canvas: HTMLCanvasElement) {
        const gl = canvas.getContext('webgl2', { antialias: true, alpha: false });
        if (!gl) throw new Error('This viewer requires WebGL 2.');
        this.gl = gl; this.canvas = canvas;
        this.camera = new Camera(canvas);
        this.initialize();
        canvas.addEventListener('webglcontextlost', this.contextLost);
        canvas.addEventListener('webglcontextrestored', this.contextRestored);
    }
    private compile(vertex: string, fragment: string) {
        const gl = this.gl;
        const program = gl.createProgram()!;
        for (const [type, source] of [[gl.VERTEX_SHADER, vertex], [gl.FRAGMENT_SHADER, fragment]] as const) {
            const shader = gl.createShader(type)!;
            gl.shaderSource(shader, source); gl.compileShader(shader);
            if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
                const error = gl.getShaderInfoLog(shader); gl.deleteShader(shader); gl.deleteProgram(program);
                throw new Error(`Shader compilation failed: ${error}`);
            }
            gl.attachShader(program, shader); gl.deleteShader(shader);
        }
        gl.linkProgram(program);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
            const error = gl.getProgramInfoLog(program); gl.deleteProgram(program);
            throw new Error(`Shader linking failed: ${error}`);
        }
        return program;
    }
    private initialize() {
        const gl = this.gl;
        this.program = this.compile(vertexSource, fragmentSource);
        this.depthProgram = this.compile(depthVertex, depthFragment);
        for (const name of ['uViewProjection','uLightProjection','uImage','uShadow','uColor','uEye','uLight','uSheen','uTextured','uToon','uKind']) {
            this.uniforms[name] = gl.getUniformLocation(this.program, name);
        }
        for (const name of ['uViewProjection','uImage','uTextured']) this.depthUniforms[name] = gl.getUniformLocation(this.depthProgram, name);
        this.anisotropy = gl.getExtension('EXT_texture_filter_anisotropic');
        this.shadowSize = Math.min(2048, gl.getParameter(gl.MAX_TEXTURE_SIZE));
        this.whiteTexture = gl.createTexture()!;
        gl.bindTexture(gl.TEXTURE_2D, this.whiteTexture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255,255,255,255]));
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        this.shadowTexture = gl.createTexture()!;
        gl.bindTexture(gl.TEXTURE_2D, this.shadowTexture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT24, this.shadowSize, this.shadowSize, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        this.shadowBuffer = gl.createFramebuffer()!;
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadowBuffer);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, this.shadowTexture, 0);
        gl.drawBuffers([gl.NONE]); gl.readBuffer(gl.NONE);
        if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('Shadow framebuffer is incomplete.');
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.enable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE);
    }
    private sync(geometry: Geometry) {
        const gl = this.gl;
        let resource = this.meshes.get(geometry);
        if (!resource) {
            resource = { vao: gl.createVertexArray()!, buffers: [], revision: -1 };
            gl.bindVertexArray(resource.vao);
            for (const [location, values, size] of [[0, geometry.positions, 3], [1, geometry.normals, 3], [2, geometry.uvs, 2]] as const) {
                const buffer = gl.createBuffer()!; resource.buffers.push(buffer);
                gl.bindBuffer(gl.ARRAY_BUFFER, buffer); gl.bufferData(gl.ARRAY_BUFFER, values, gl.DYNAMIC_DRAW);
                gl.enableVertexAttribArray(location); gl.vertexAttribPointer(location, size, gl.FLOAT, false, 0, 0);
            }
            const index = gl.createBuffer()!; resource.buffers.push(index);
            gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, index); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, geometry.indices, gl.STATIC_DRAW);
            resource.revision = geometry.revision;
            this.meshes.set(geometry, resource);
        } else {
            gl.bindVertexArray(resource.vao);
            if (resource.revision !== geometry.revision) {
                [geometry.positions, geometry.normals, geometry.uvs].forEach((data, i) => {
                    gl.bindBuffer(gl.ARRAY_BUFFER, resource!.buffers[i]); gl.bufferSubData(gl.ARRAY_BUFFER, 0, data);
                });
                resource.revision = geometry.revision;
            }
        }
        return resource;
    }
    private texture(asset?: ImageTexture) {
        if (!asset || asset.disposed) return this.whiteTexture;
        const existing = this.textures.get(asset);
        if (existing) return existing;
        const gl = this.gl, texture = gl.createTexture()!;
        gl.bindTexture(gl.TEXTURE_2D, texture);
        let source: TexImageSource = asset.image;
        const maxSize = Math.min(4096, gl.getParameter(gl.MAX_TEXTURE_SIZE));
        const scale = Math.min(1, maxSize / Math.max(asset.width, asset.height));
        if (scale < 1) {
            const resized = document.createElement('canvas');
            resized.width = Math.max(1, Math.round(asset.width * scale)); resized.height = Math.max(1, Math.round(asset.height * scale));
            resized.getContext('2d')!.drawImage(asset.image, 0, 0, resized.width, resized.height); source = resized;
        }
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
        gl.generateMipmap(gl.TEXTURE_2D);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        if (this.anisotropy) gl.texParameterf(gl.TEXTURE_2D, this.anisotropy.TEXTURE_MAX_ANISOTROPY_EXT,
            Math.min(16, gl.getParameter(this.anisotropy.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));
        this.textures.set(asset, texture);
        return texture;
    }
    render(draws: RenderMesh[], poleLength: number) {
        if (this.lost) return;
        const gl = this.gl;
        this.releaseDisposed();
        const dpr = Math.min(window.devicePixelRatio, 2);
        const width = Math.max(1, Math.round(this.canvas.clientWidth * dpr));
        const height = Math.max(1, Math.round(this.canvas.clientHeight * dpr));
        if (this.canvas.width !== width || this.canvas.height !== height) { this.canvas.width = width; this.canvas.height = height; }
        const center = new Vec3(0, -5 + poleLength / 2, 0);
        const extent = Math.max(7, poleLength * 0.72);
        const lightMatrix = multiply4(orthographic(-extent, extent, -extent, extent, 0.1, extent * 7),
            lookAt(center.clone().addScaledVector(this.light, extent * 3), center));
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadowBuffer);
        gl.viewport(0, 0, this.shadowSize, this.shadowSize); gl.clear(gl.DEPTH_BUFFER_BIT);
        gl.useProgram(this.depthProgram);
        gl.disable(gl.CULL_FACE);
        gl.uniformMatrix4fv(this.depthUniforms.uViewProjection, false, lightMatrix);
        gl.uniform1i(this.depthUniforms.uImage, 0);
        // Do not bind the depth target as a sampler while writing into it.
        gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.whiteTexture);
        for (const mesh of draws) {
            if (!mesh.visible || !mesh.castShadow || mesh.geometry.disposed) continue;
            gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.texture(mesh.material.texture));
            gl.uniform1f(this.depthUniforms.uTextured, mesh.material.texture ? 1 : 0);
            this.sync(mesh.geometry); gl.drawElements(gl.TRIANGLES, mesh.geometry.indices.length, gl.UNSIGNED_INT, 0);
        }
        gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, width, height);
        gl.clearColor(0.102, 0.102, 0.102, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        gl.useProgram(this.program);
        gl.uniformMatrix4fv(this.uniforms.uViewProjection, false, this.camera.matrix(width / height));
        gl.uniformMatrix4fv(this.uniforms.uLightProjection, false, lightMatrix);
        gl.uniform3f(this.uniforms.uEye, this.camera.eye.x, this.camera.eye.y, this.camera.eye.z);
        gl.uniform3f(this.uniforms.uLight, this.light.x, this.light.y, this.light.z);
        gl.uniform1i(this.uniforms.uImage, 0); gl.uniform1i(this.uniforms.uShadow, 1);
        gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.shadowTexture);
        const kinds = { cloth: 0, gold: 1, wood: 2, base: 3, floor: 4 };
        for (const mesh of draws) {
            if (!mesh.visible || mesh.geometry.disposed) continue;
            if (mesh.doubleSided) gl.disable(gl.CULL_FACE); else gl.enable(gl.CULL_FACE);
            const mat = mesh.material;
            gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.texture(mat.texture));
            gl.uniform3fv(this.uniforms.uColor, mat.color); gl.uniform1i(this.uniforms.uKind, kinds[mat.kind]);
            gl.uniform1f(this.uniforms.uSheen, mat.sheen); gl.uniform1f(this.uniforms.uToon, mat.toon ? 1 : 0);
            gl.uniform1f(this.uniforms.uTextured, mat.texture ? 1 : 0);
            this.sync(mesh.geometry); gl.drawElements(gl.TRIANGLES, mesh.geometry.indices.length, gl.UNSIGNED_INT, 0);
        }
        gl.bindVertexArray(null);
    }
    private releaseDisposed() {
        const gl = this.gl;
        for (const [geometry, resource] of this.meshes) if (geometry.disposed) {
            resource.buffers.forEach(buffer => gl.deleteBuffer(buffer)); gl.deleteVertexArray(resource.vao); this.meshes.delete(geometry);
        }
        for (const [asset, texture] of this.textures) if (asset.disposed) { gl.deleteTexture(texture); this.textures.delete(asset); }
    }
    private contextLost = (event: Event) => { event.preventDefault(); this.lost = true; };
    private contextRestored = () => {
        this.meshes.clear(); this.textures.clear();
        try { this.initialize(); this.lost = false; }
        catch (error) { this.canvas.dispatchEvent(new CustomEvent('rendererror', { detail: String(error) })); }
    };
    dispose() {
        this.canvas.removeEventListener('webglcontextlost', this.contextLost);
        this.canvas.removeEventListener('webglcontextrestored', this.contextRestored);
        this.camera.dispose();
        const gl = this.gl;
        for (const resource of this.meshes.values()) { resource.buffers.forEach(buffer => gl.deleteBuffer(buffer)); gl.deleteVertexArray(resource.vao); }
        for (const texture of this.textures.values()) gl.deleteTexture(texture);
        gl.deleteTexture(this.whiteTexture); gl.deleteTexture(this.shadowTexture); gl.deleteFramebuffer(this.shadowBuffer);
        gl.deleteProgram(this.program); gl.deleteProgram(this.depthProgram);
        this.meshes.clear(); this.textures.clear();
    }
}
