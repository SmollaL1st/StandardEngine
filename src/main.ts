import './style.css';
import { Renderer } from './engine/Renderer';
import { Vec3 } from './engine/math';
import type { ImageTexture } from './engine/Geometry';
import { Stand } from './rendering/Stand';
import { Flag } from './Flag';
import { UIController, type UICallbacks } from './ui/UIController';
import { textileSizeForPole } from './drape/CeremonialDrape';

const canvas = document.createElement('canvas');
document.body.appendChild(canvas);
document.getElementById('app')?.remove();
const status = document.createElement('div');
status.className = 'viewer-status'; status.setAttribute('role', 'status'); document.body.appendChild(status);
function showError(message: string) { status.textContent = message; }
canvas.addEventListener('rendererror', event => showError((event as CustomEvent<string>).detail));

let renderer: Renderer;
try { renderer = new Renderer(canvas); } catch (error) { showError(String(error)); throw error; }
const stand = new Stand();
let flag: Flag | undefined;
let imageAspect = 1.5;
function updateDrape() {
    if (!flag) return;
    flag.configure(ui.params.drape); stand.updateAttachments(flag.drape.height);
}
function updateFringe() { flag?.setFringe(ui.params.fringeLength, ui.params.fringeDensity, ui.params.showFringe); }
function updateSupport() {
    stand.updatePole(ui.params.poleLength); renderer.camera.fit(ui.params.poleLength);
    if (!flag) return;
    const { width, height } = textileSizeForPole(imageAspect, ui.params.poleLength);
    flag.resize(width, height); flag.setAttachmentHeight(stand.flagTop); stand.updateAttachments(flag.drape.height);
}
const callbacks: UICallbacks = {
    onResetFlag: () => { updateDrape(); flag?.reset(); }, onDrapeChange: updateDrape,
    onUpdatePole: updateSupport, onFringeChange: updateFringe,
    onSheenChange: value => flag?.setSheen(value), onMaterialChange: style => flag?.setMaterialStyle(style),
    onProjectionChange: value => { renderer.camera.projection = value; },
    onResetView: () => renderer.camera.fit(ui.params.poleLength, true), onLoadError: showError,
};
function rebuildFlag(aspect: number, texture: ImageTexture) {
    if (!Number.isFinite(aspect) || aspect <= 0) { texture.dispose(); return; }
    flag?.dispose(); imageAspect = aspect;
    const { width, height } = textileSizeForPole(aspect, ui.params.poleLength);
    flag = new Flag(width, height, ui.params.materialType);
    flag.setAttachmentHeight(stand.flagTop); updateDrape(); updateFringe(); flag.setSheen(ui.params.sheen);
    flag.mesh.material.texture = texture; status.textContent = '';
}
const ui = new UIController(callbacks, rebuildFlag);
renderer.camera.rightInset = ui.gui.domElement.getBoundingClientRect().width;
updateSupport();
ui.loadDefaultTexture(`${import.meta.env.BASE_URL}Flag.svg`, rebuildFlag);
const wind = new Vec3();
let previousTime = 0, animation = 0;
function animate(timestamp: number) {
    animation = requestAnimationFrame(animate);
    const elapsed = previousTime ? Math.min((timestamp - previousTime) / 1000, 0.1) : 0; previousTime = timestamp;
    if (flag && ui.params.enableMotion) {
        wind.set(ui.params.windDirectionX, 0, ui.params.windDirectionZ).normalize().multiplyScalar(ui.params.windSpeed);
        flag.advance(elapsed, wind, ui.params.softness);
    }
    if (flag) ui.params.bendStrength = Math.round(flag.drape.appliedBendStrength * 100);
    renderer.render([...stand.meshes, ...(flag?.meshes ?? [])], ui.params.poleLength);
}
animation = requestAnimationFrame(animate);
if (import.meta.hot) import.meta.hot.dispose(() => {
    cancelAnimationFrame(animation); flag?.dispose(); stand.dispose(); renderer.dispose(); ui.dispose(); canvas.remove(); status.remove();
});
