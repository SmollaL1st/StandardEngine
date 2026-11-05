export const mainVertex = `#version 300 es
precision highp float;
layout(location=0) in vec3 aPosition;
layout(location=1) in vec3 aNormal;
layout(location=2) in vec2 aUV;
layout(location=3) in vec3 aTangent;
layout(location=4) in vec2 aAO;
uniform mat4 uViewProj;
uniform mat4 uModel;
out vec3 vWorld;
out vec3 vLocal;
out vec3 vNormal;
out vec3 vTangent;
out vec2 vUV;
out vec2 vAO;
void main() {
    vec4 world = uModel * vec4(aPosition, 1.0);
    mat3 m = mat3(uModel);
    vWorld = world.xyz; vLocal = aPosition;
    vNormal = m * aNormal; vTangent = m * aTangent;
    vUV = aUV; vAO = aAO;
    gl_Position = uViewProj * world;
}`;

export const mainFragment = `#version 300 es
precision highp float;
precision highp sampler2DShadow;
in vec3 vWorld;
in vec3 vLocal;
in vec3 vNormal;
in vec3 vTangent;
in vec2 vUV;
in vec2 vAO;

uniform int uType;            // 0 cloth, 1 metal, 2 lacquer, 3 strand, 4 floor, 5 shadow catcher
uniform vec3 uBase;
uniform float uRough;
uniform float uSpec;
uniform float uSheen;
uniform float uAniso;
uniform float uTrans;
uniform float uWeave;
uniform float uGrain;
uniform vec2 uStripes;
uniform vec2 uSize;
uniform float uTextured;
uniform float uFlipU;
uniform sampler2D uTex;
uniform float uToon;           // cel shading for the anime style
uniform float uInk;            // 1 where outlines may be drawn

uniform sampler2DShadow uShadow;
uniform sampler2D uShadowDepth;
uniform mat4 uLightVP;
uniform vec4 uShadowInfo;      // x: depth range (m), y: tan(light radius), z: texel (uv), w: enabled
uniform vec2 uShadowExtent;    // light frustum size, m

uniform vec3 uEye;
uniform vec3 uKeyDir; uniform vec3 uKeyCol;
uniform vec3 uFillDir; uniform vec3 uFillCol;
uniform vec3 uRimDir; uniform vec3 uRimCol;
uniform vec3 uSky; uniform vec3 uGround;
uniform float uExposure;
uniform vec4 uContact;         // xz centre, footprint radius, strength
uniform float uCatcherOpacity;

layout(location=0) out vec4 outColor;
layout(location=1) out vec4 outInk;
const float PI = 3.14159265359;

const vec2 DISK[16] = vec2[](
    vec2(-0.9420, -0.3990), vec2(0.9456, -0.7689), vec2(-0.0942, -0.9294), vec2(0.3450, 0.2939),
    vec2(-0.9159, 0.4577), vec2(-0.8154, -0.8791), vec2(-0.3828, 0.2768), vec2(0.9748, 0.7565),
    vec2(0.4432, -0.9751), vec2(0.5374, -0.4737), vec2(-0.2650, -0.4189), vec2(0.7920, 0.1909),
    vec2(-0.2419, 0.9971), vec2(-0.8141, 0.9144), vec2(0.1998, 0.7864), vec2(0.1438, -0.1410));

float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
float lum(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

// Contact-hardening soft shadow (PCSS) from the key light.
float shadowAt(vec3 n, vec3 L) {
    if (uShadowInfo.w < 0.5) return 1.0;
    vec3 side = dot(n, L) >= 0.0 ? n : -n;
    float offset = max(uShadowExtent.x, uShadowExtent.y) * uShadowInfo.z * 1.5;
    vec4 s = uLightVP * vec4(vWorld + side * offset, 1.0);
    vec3 c = s.xyz / s.w * 0.5 + 0.5;
    if (c.x <= 0.0 || c.x >= 1.0 || c.y <= 0.0 || c.y >= 1.0 || c.z >= 1.0) return 1.0;
    float a = ign(gl_FragCoord.xy) * 6.2831853;
    mat2 rot = mat2(cos(a), sin(a), -sin(a), cos(a));
    float bias = 0.0015 / uShadowInfo.x;
    vec2 search = vec2(clamp(uShadowInfo.y * 1.2, 0.0005, 0.25)) / uShadowExtent;
    float blockers = 0.0, depthSum = 0.0;
    for (int i = 0; i < 16; i++) {
        float d = texture(uShadowDepth, c.xy + rot * DISK[i] * search).r;
        if (d < c.z - bias) { blockers += 1.0; depthSum += d; }
    }
    if (blockers < 0.5) return 1.0;
    float distance = (c.z - depthSum / blockers) * uShadowInfo.x;
    vec2 radius = vec2(distance * uShadowInfo.y) / uShadowExtent + uShadowInfo.z * 1.25;
    float lit = 0.0;
    for (int i = 0; i < 16; i++) lit += texture(uShadow, vec3(c.xy + rot * DISK[i] * radius, c.z - bias));
    return lit / 16.0;
}

vec3 hemisphere(vec3 n) { return mix(uGround, uSky, n.y * 0.5 + 0.5); }

float softbox(vec3 r, vec3 l, float w) { return exp((dot(r, l) - 1.0) / w) * 0.035 / w; }

// Procedural studio surroundings: floor, walls, ceiling and soft boxes where the lights are.
vec3 environment(vec3 r, float rough) {
    float w = mix(0.012, 0.55, rough * rough);
    vec3 room = mix(uGround * 0.8, uSky, smoothstep(-0.2, 0.5, r.y));
    room += uSky * 0.6 * exp(-abs(r.y - 0.05) * mix(14.0, 2.0, rough)) * (1.0 - 0.5 * rough);
    room += uKeyCol * softbox(r, uKeyDir, w) + uFillCol * softbox(r, uFillDir, w * 1.6) + uRimCol * softbox(r, uRimDir, w);
    room += uSky * 1.2 * softbox(r, normalize(vec3(0.0, 1.0, 0.25)), w * 2.0);
    return room;
}

vec3 envBRDF(vec3 F0, float rough, float nv) {
    const vec4 c0 = vec4(-1.0, -0.0275, -0.572, 0.022);
    const vec4 c1 = vec4(1.0, 0.0425, 1.04, -0.04);
    vec4 r = rough * c0 + c1;
    float a004 = min(r.x * r.x, exp2(-9.28 * nv)) * r.x + r.y;
    vec2 ab = vec2(-1.04, 1.04) * a004 + r.zw;
    return F0 * ab.x + ab.y;
}

float ggx(float nh, float a) { float a2 = a * a; float d = nh * nh * (a2 - 1.0) + 1.0; return a2 / (PI * d * d); }
float smith(float nv, float nl, float a) {
    float a2 = a * a;
    return 0.5 / max(nl * sqrt(nv * nv * (1.0 - a2) + a2) + nv * sqrt(nl * nl * (1.0 - a2) + a2), 1e-5);
}
vec3 schlick(vec3 F0, float c) { return F0 + (1.0 - F0) * pow(1.0 - c, 5.0); }

vec3 metalLight(vec3 n, vec3 v, vec3 l, vec3 col, vec3 F0, float rough, float sh) {
    vec3 h = normalize(l + v);
    float nl = max(dot(n, l), 0.0), nv = max(dot(n, v), 1e-3), nh = max(dot(n, h), 0.0), lh = max(dot(l, h), 0.0);
    float a = max(rough * rough, 0.002);
    return PI * ggx(nh, a) * smith(nv, nl, a) * schlick(F0, lh) * nl * col * sh;
}

// Thin textile: wrapped diffuse, light through the weave, sheen and an anisotropic satin lustre.
vec3 clothLight(vec3 n, vec3 v, vec3 t, vec3 b, vec3 l, vec3 col, vec3 albedo, float sh) {
    float ndl = dot(n, l);
    float nl = max(ndl, 0.0), nv = max(dot(n, v), 1e-3);
    vec3 h = normalize(l + v);
    float nh = max(dot(n, h), 0.0), lh = max(dot(l, h), 1e-3);
    vec3 diffuse = albedo * max((ndl + 0.18) / 1.18, 0.0);
    vec3 through = albedo * sqrt(albedo) * max(-ndl, 0.0) * uTrans;
    float sr = 0.35;
    float inv = 1.0 / sr, sin2 = max(1.0 - nh * nh, 0.0078125);
    float D = (2.0 + inv) * pow(sin2, inv * 0.5) / (2.0 * PI);
    float V = 1.0 / (4.0 * (nl + nv - nl * nv) + 1e-4);
    vec3 sheen = mix(vec3(1.0), albedo, 0.45) * uSheen * D * V * nl * PI;
    float at = max(0.03, uRough * (1.0 - uAniso * 0.8)), ab = max(0.03, uRough * (1.0 + uAniso * 1.5));
    float th = dot(t, h), bh = dot(b, h);
    float a2 = at * ab; vec3 f = vec3(ab * th, at * bh, a2 * nh);
    float w2 = a2 / dot(f, f);
    float Ds = a2 * w2 * w2 / PI;
    float F = 0.04 + 0.96 * pow(1.0 - lh, 5.0);
    vec3 spec = vec3(Ds * F / (4.0 * lh * lh)) * uSpec * nl * PI;
    return (diffuse + through + sheen + spec) * col * sh;
}

vec3 strandLight(vec3 t, vec3 n, vec3 v, vec3 l, vec3 col, vec3 F0, float sh, float rough) {
    float tl = dot(t, l), tv = dot(t, v);
    float sl = sqrt(max(0.0, 1.0 - tl * tl)), sv = sqrt(max(0.0, 1.0 - tv * tv));
    float p = mix(160.0, 18.0, rough);
    float primary = pow(max(0.0, sl * sv - tl * tv), p) * (p + 2.0) / (2.0 * PI) * 0.35;
    float secondary = pow(max(0.0, sl * sv - tl * tv), p * 0.25) * 0.15;
    float wrap = max(dot(n, l) * 0.5 + 0.5, 0.0);
    return col * sh * (F0 * 0.32 * sl * wrap + F0 * primary * PI * 0.1 + F0 * F0 * secondary * wrap);
}

float grain(vec3 p) {
    float around = atan(p.z, p.x);
    float g = sin(around * 7.0 + sin(p.y * 2.3) * 3.0 + sin(p.y * 0.7 + around * 2.0) * 4.0);
    float fine = sin(around * 41.0 + p.y * 3.0 + sin(p.y * 9.0) * 1.5);
    return 0.5 + 0.5 * (0.7 * g + 0.3 * fine);
}

vec3 tonemap(vec3 c) {
    // Khronos PBR Neutral: keeps base colours of the print where they are.
    const float start = 0.76, desat = 0.15;
    float x = min(c.r, min(c.g, c.b));
    float off = x < 0.08 ? x - 6.25 * x * x : 0.04;
    c -= off;
    float peak = max(c.r, max(c.g, c.b));
    if (peak < start) return c;
    float d = 1.0 - start;
    float newPeak = 1.0 - d * d / (peak + d - start);
    c *= newPeak / peak;
    float g = 1.0 - 1.0 / (desat * (peak - newPeak) + 1.0);
    return mix(c, vec3(newPeak), g);
}
vec3 encode(vec3 c) {
    c = clamp(c, 0.0, 1.0);
    return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}

float contactShade() {
    vec2 d = vWorld.xz - uContact.xy;
    float r = length(d);
    return 1.0 - uContact.w * (1.0 - smoothstep(uContact.z * 0.7, uContact.z * 1.9, r));
}

// Anime style: two flat tones split by the key light, a hard highlight and a rim.
vec3 toonShade(vec3 base, vec3 n, vec3 v, float sh, float gloss, float metal) {
    float lk = lum(uKeyCol), la = lum(uSky);
    float ndl = dot(n, uKeyDir);
    float w = max(fwidth(ndl), 1e-3);
    float lit = smoothstep(0.1 - w, 0.1 + w, ndl) * smoothstep(0.35, 0.65, sh);
    vec3 shadowTone = base * (0.25 + la * 1.25) * vec3(0.86, 0.9, 1.06);
    vec3 litTone = base * (0.3 + la * 0.9 + lk * 0.75);
    vec3 c = mix(shadowTone, litTone, lit);
    vec3 h = normalize(uKeyDir + v);
    float spec = pow(max(dot(n, h), 0.0), mix(16.0, 70.0, gloss));
    float sw = max(fwidth(spec), 1e-3);
    c += mix(vec3(1.0), base, metal) * smoothstep(0.5 - sw, 0.5 + sw, spec) * gloss * 0.5 * lk * lit;
    float edge = 1.0 - max(dot(n, v), 0.0);
    float rw = max(fwidth(edge), 1e-3);
    c += mix(vec3(1.0), base, 0.5) * smoothstep(0.62 - rw, 0.62 + rw, edge) * lum(uRimCol) * 0.4
        * max(dot(n, uRimDir) * 0.5 + 0.5, 0.0);
    return c;
}

void main() {
    vec3 n = normalize(vNormal);
    vec3 v = normalize(uEye - vWorld);
    float keyShadow;
    outInk = vec4(uInk, 0.0, 0.0, 1.0);

    if (uType >= 4) {
        vec3 up = vec3(0.0, 1.0, 0.0);
        keyShadow = shadowAt(up, uKeyDir);
        float contact = contactShade();
        float kl = max(uKeyDir.y, 0.0), fl = max(uFillDir.y, 0.0), rl = max(uRimDir.y, 0.0);
        vec3 open = hemisphere(up) + uKeyCol * kl + uFillCol * fl + uRimCol * rl;
        vec3 shaded = hemisphere(up) * contact + uKeyCol * kl * keyShadow + (uFillCol * fl + uRimCol * rl) * contact;
        if (uType == 5) {
            float alpha = clamp(1.0 - lum(shaded) / max(lum(open), 1e-4), 0.0, 1.0) * uCatcherOpacity;
            // Flat, slightly translucent shadow shapes in the anime style.
            if (uToon > 0.5) alpha = smoothstep(0.2, 0.3, alpha) * 0.45 * uCatcherOpacity;
            outColor = vec4(0.0, 0.0, 0.0, alpha);
            return;
        }
        vec3 c = uBase * shaded;
        vec3 r = reflect(-v, up);
        c += environment(r, 0.6) * envBRDF(vec3(0.03), 0.6, max(dot(up, v), 1e-3)) * contact * 0.6;
        outColor = vec4(encode(tonemap(c * exp2(uExposure))), 1.0);
        return;
    }

    if (uType == 0 && !gl_FrontFacing) n = -n;
    keyShadow = shadowAt(n, uKeyDir);
    vec3 color = vec3(0.0);
    float nv = max(dot(n, v), 1e-3);

    if (uType == 0) {
        vec2 uv = uFlipU > 0.5 ? vec2(1.0 - vUV.x, vUV.y) : vUV;
        vec4 tex = uTextured > 0.5 ? texture(uTex, uv) : vec4(1.0);
        if (tex.a < 0.5) discard;
        vec3 albedo = uBase * tex.rgb;
        if (!gl_FrontFacing) albedo = mix(albedo, vec3(lum(albedo)), 0.08) * 0.94;
        vec3 t = normalize(vTangent - n * dot(vTangent, n));
        vec3 b = cross(n, t);
        if (uToon > 0.5) {
            outColor = vec4(encode(tonemap(toonShade(albedo, n, v, keyShadow, uSpec, 0.0) * exp2(uExposure))), 1.0);
            return;
        }
        // Woven threads: a fine micro-relief that fades out before it can alias.
        vec2 m = vec2(vUV.x * uSize.x, (1.0 - vUV.y) * uSize.y) / 0.0011;
        float cycles = max(length(fwidth(m.x)), length(fwidth(m.y)));
        float weave = uWeave * (1.0 - smoothstep(0.25, 0.6, cycles));
        float wu = sin(m.x * 6.2831853), wv = sin(m.y * 6.2831853 + step(0.0, wu) * 3.14159);
        n = normalize(n + (t * wu * 0.12 + b * wv * 0.12) * weave);
        albedo *= 1.0 - 0.06 * weave * (0.5 + 0.5 * wu * wv);
        float occlusion = gl_FrontFacing ? vAO.x : vAO.y;
        float ao = 1.0 - clamp(occlusion, 0.0, 0.85);
        color += clothLight(n, v, t, b, uKeyDir, uKeyCol, albedo, keyShadow) * mix(1.0, ao, 0.35);
        color += clothLight(n, v, t, b, uFillDir, uFillCol, albedo, 1.0) * ao;
        color += clothLight(n, v, t, b, uRimDir, uRimCol, albedo, 1.0) * mix(1.0, ao, 0.6);
        color += albedo * hemisphere(n) * ao;
        color += albedo * hemisphere(-n) * uTrans * 0.3 * ao;
        float rim = pow(1.0 - nv, 4.0);
        color += mix(vec3(1.0), albedo, 0.5) * uSheen * rim * hemisphere(n) * 0.35 * ao;
        // Satin mirrors the room: soft boxes become long highlights along the folds.
        // Stretching the lookup along the warp approximates the anisotropic lobe.
        vec3 r = reflect(-v, n);
        vec3 ra = normalize(r - t * dot(r, t) * uAniso * 0.55);
        float roughEnv = clamp(uRough * 0.9, 0.08, 0.9);
        float fresnel = 0.05 + 0.95 * pow(1.0 - nv, 5.0);
        color += environment(ra, roughEnv) * mix(vec3(1.0), albedo, 0.35) * (0.22 + fresnel) * uSpec * ao * mix(0.6, 1.0, keyShadow);
    } else if (uToon > 0.5) {
        // Painted gold reads richer than physical F0: deepen the metal colours.
        vec3 base = uType == 2 ? uBase * mix(1.0, 0.75 + 0.4 * grain(vLocal), uGrain) : pow(uBase, vec3(1.7)) * 0.9;
        if (uType == 3) {
            float stripe = 0.5 + 0.5 * sin(6.2831853 * (vUV.x * uStripes.x + vUV.y * uStripes.y));
            base *= mix(0.75, 1.0, stripe) * (1.0 - clamp(vAO.x, 0.0, 0.9) * 0.6);
        }
        color = toonShade(base, n, v, keyShadow, uType == 2 ? 0.8 : 1.0, uType == 2 ? 0.0 : 1.0);
    } else if (uType == 1) {
        vec3 F0 = uBase;
        color += metalLight(n, v, uKeyDir, uKeyCol, F0, uRough, keyShadow);
        color += metalLight(n, v, uFillDir, uFillCol, F0, uRough, 1.0);
        color += metalLight(n, v, uRimDir, uRimCol, F0, uRough, 1.0);
        vec3 r = reflect(-v, n);
        color += environment(r, uRough) * envBRDF(F0, uRough, nv) * mix(0.55, 1.0, keyShadow);
    } else if (uType == 2) {
        vec3 albedo = uBase * mix(1.0, 0.55 + 0.75 * grain(vLocal), uGrain);
        for (int i = 0; i < 3; i++) {
            vec3 l = i == 0 ? uKeyDir : (i == 1 ? uFillDir : uRimDir);
            vec3 c = i == 0 ? uKeyCol : (i == 1 ? uFillCol : uRimCol);
            float sh = i == 0 ? keyShadow : 1.0;
            color += albedo * max(dot(n, l), 0.0) * c * sh;
            color += metalLight(n, v, l, c, vec3(0.04), uRough, sh) * uSpec;
        }
        color += albedo * hemisphere(n);
        vec3 r = reflect(-v, n);
        color += environment(r, uRough) * envBRDF(vec3(0.04), uRough, nv) * uSpec;
    } else {
        vec3 t = normalize(vTangent);
        float stripe = 0.5 + 0.5 * sin(6.2831853 * (vUV.x * uStripes.x + vUV.y * uStripes.y));
        vec3 F0 = uBase * mix(0.55, 1.0, stripe);
        // Twisted cords: shading follows the twist, so the normal tilts with each stripe.
        n = normalize(n + t * (stripe - 0.5) * 0.6);
        float ao = 1.0 - clamp(vAO.x, 0.0, 0.9);
        F0 *= ao;
        color += strandLight(t, n, v, uKeyDir, uKeyCol, F0, keyShadow, uRough);
        color += strandLight(t, n, v, uFillDir, uFillCol, F0, 1.0, uRough);
        color += strandLight(t, n, v, uRimDir, uRimCol, F0, 1.0, uRough);
        color += metalLight(n, v, uKeyDir, uKeyCol, F0, uRough, keyShadow) * 0.5;
        vec3 r = reflect(-v, n);
        color += environment(r, max(uRough, 0.45)) * envBRDF(F0, max(uRough, 0.45), nv) * mix(0.35, 0.8, stripe) * mix(0.6, 1.0, keyShadow);
    }
    outColor = vec4(encode(tonemap(color * exp2(uExposure))), 1.0);
}`;

export const depthVertex = `#version 300 es
layout(location=0) in vec3 aPosition;
layout(location=2) in vec2 aUV;
uniform mat4 uViewProj;
uniform mat4 uModel;
out vec2 vUV;
void main() { vUV = aUV; gl_Position = uViewProj * uModel * vec4(aPosition, 1.0); }`;

export const depthFragment = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D uTex;
uniform float uTextured;
uniform float uFlipU;
void main() {
    vec2 uv = uFlipU > 0.5 ? vec2(1.0 - vUV.x, vUV.y) : vUV;
    if (uTextured > 0.5 && texture(uTex, uv).a < 0.5) discard;
}`;

export const postVertex = `#version 300 es
void main() {
    vec2 p = vec2(gl_VertexID == 1 ? 3.0 : -1.0, gl_VertexID == 2 ? 3.0 : -1.0);
    gl_Position = vec4(p, 0.0, 1.0);
}`;

// Ink outlines for the anime style, found from depth discontinuities.
// A line is drawn where the nearer surface allows ink, so fine fringe threads stay clean.
export const postFragment = `#version 300 es
precision highp float;
uniform sampler2D uColor;
uniform sampler2D uInkMask;
uniform sampler2D uDepth;
uniform vec2 uTexel;
uniform float uLine;
uniform vec2 uNearFar;
uniform vec3 uInkColor;
uniform float uSaturation;
out vec4 outColor;
float linear(vec2 uv) {
    float z = texture(uDepth, uv).r * 2.0 - 1.0;
    float n = uNearFar.x, f = uNearFar.y;
    return 2.0 * n * f / (f + n - z * (f - n));
}
void main() {
    vec2 uv = gl_FragCoord.xy * uTexel;
    vec4 c = texture(uColor, uv);
    float zc = linear(uv), ic = texture(uInkMask, uv).r;
    float edge = 0.0;
    const vec2 AXES[4] = vec2[](vec2(1.0, 0.0), vec2(0.0, 1.0), vec2(0.7071, 0.7071), vec2(0.7071, -0.7071));
    for (int k = 0; k < 4; k++) {
        vec2 o = AXES[k] * uLine * uTexel;
        float za = linear(uv + o), zb = linear(uv - o);
        // Second difference: ignores smooth surfaces seen at a grazing angle.
        float curve = abs(za + zb - 2.0 * zc), near = min(zc, min(za, zb));
        if (curve > near * 0.012 + 0.004) {
            float ink = za <= zb && za < zc ? texture(uInkMask, uv + o).r : zb < zc ? texture(uInkMask, uv - o).r : ic;
            edge = max(edge, ink);
        }
    }
    vec3 rgb = c.a > 0.0 ? c.rgb / c.a : vec3(0.0);
    float l = dot(rgb, vec3(0.2126, 0.7152, 0.0722));
    rgb = clamp(mix(vec3(l), rgb, uSaturation), 0.0, 1.0);
    float alpha = max(c.a, edge);
    outColor = vec4(mix(rgb * c.a, uInkColor, edge), alpha);
}`;
