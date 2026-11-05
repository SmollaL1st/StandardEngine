import GUI, { type Controller } from 'lil-gui';
import pkg from '../../package.json';
import { FABRICS, type FabricId, type Settings } from '../app/Settings';
import { LIGHT_PRESETS } from '../render/Lighting';

export type ChangeKind = 'size' | 'yaw' | 'mirror' | 'fabric' | 'material' | 'pose' | 'sag' | 'fringe' | 'light' | 'style' | 'view' | 'output';

export interface PanelActions {
    upload(): void;
    newFolds(): void;
    resetView(): void;
    exportPNG(): void;
    copyPNG(): void;
    resetAll(): void;
    changed(kind: ChangeKind): void;
}

const options = <T extends string>(entries: Record<T, string>) =>
    Object.fromEntries(Object.entries(entries).map(([value, label]) => [label, value])) as Record<string, T>;

/** Compact settings panel: the flag, its dome drape, light and PNG export. */
export class Panel {
    readonly gui: GUI;

    constructor(container: HTMLElement, s: Settings, actions: PanelActions) {
        const gui = this.gui = new GUI({ container, title: 'Купольный флаг', width: 300 });
        const on = (kind: ChangeKind) => () => actions.changed(kind);

        const flag = gui.addFolder('Флаг');
        flag.add({ upload: () => actions.upload() }, 'upload').name('📂 Загрузить изображение…');
        flag.add(s.flag, 'height', 0.6, 1.4, 0.01).name('Высота полотна, м').onFinishChange(on('size'));
        flag.add(s.flag, 'yaw', -180, 180, 1).name('Поворот, °').onChange(on('yaw'));
        flag.add(s.flag, 'mirror').name('Отзеркалить флаг').onChange(on('mirror'));
        flag.add(s.flag, 'flipImage').name('Отразить рисунок').onChange(on('mirror'));
        const fabrics = Object.fromEntries(Object.entries(FABRICS).map(([k, f]) => [k, f.label])) as Record<FabricId, string>;
        flag.add(s.flag, 'fabric', options(fabrics)).name('Ткань').onChange(() => {
            s.flag.gloss = FABRICS[s.flag.fabric].gloss;
            actions.changed('fabric'); this.refresh();
        });
        flag.add(s.flag, 'gloss', 0, 1, 0.01).name('Блеск ткани').onChange(on('material'));

        const dome = gui.addFolder('Купол');
        dome.add({ folds: () => actions.newFolds() }, 'folds').name('🎲 Новые складки');
        dome.add(s.drape, 'opening', 0, 1, 0.01).name('Раскрытие купола').onChange(on('pose'));
        dome.add(s.drape, 'folds', 1, 6, 1).name('Складок на виток').onChange(on('pose'));
        dome.add(s.drape, 'foldDepth', 0, 1, 0.01).name('Глубина складок').onChange(on('pose'));
        dome.add(s.drape, 'sag', 0, 1, 0.01).name('Провисание ткани').onChange(on('sag'));

        const fringe = gui.addFolder('Бахрома и шнур');
        fringe.add(s.fringe, 'show').name('Бахрома').onChange(on('fringe'));
        fringe.add(s.fringe, 'color', options({ gold: 'Золото', silver: 'Серебро' })).name('Цвет').onChange(on('fringe'));
        fringe.add(s.fringe, 'length', 1.5, 10, 0.1).name('Длина, см').onChange(on('fringe'));
        fringe.add(s.fringe, 'density', 30, 150, 1).name('Нитей на 10 см').onFinishChange(on('fringe'));
        fringe.add(s.fringe, 'cord').name('Шнур с кистями').onChange(on('fringe'));

        const light = gui.addFolder('Свет');
        light.add(s.view, 'style', options({ real: 'Реалистичный', anime: 'Аниме' })).name('Стиль').onChange(on('style'));
        light.add(s.view, 'lineWidth', 0.5, 5, 0.1).name('Толщина контура').onChange(on('style'));
        const presets = { ...Object.fromEntries(Object.entries(LIGHT_PRESETS).map(([k, p]) => [p.label, k])), 'Свой': 'custom' };
        const preset = light.add(s.light, 'preset', presets).name('Пресет').onChange((id: string) => {
            const p = LIGHT_PRESETS[id];
            if (p) Object.assign(s.light, p.values);
            actions.changed('light'); this.refresh();
        });
        const custom = (c: Controller) => c.onChange(() => { s.light.preset = 'custom'; preset.updateDisplay(); actions.changed('light'); });
        custom(light.add(s.light, 'keyAzimuth', -180, 180, 1).name('Откуда светит, °'));
        custom(light.add(s.light, 'keyElevation', 0, 89, 1).name('Высота света, °'));
        custom(light.add(s.light, 'keyIntensity', 0, 3, 0.01).name('Яркость'));
        custom(light.add(s.light, 'keyTemperature', 2500, 9000, 50).name('Температура, K'));
        custom(light.add(s.light, 'softness', 0, 1, 0.01).name('Мягкость теней'));
        custom(light.add(s.light, 'rimIntensity', 0, 3, 0.01).name('Контровой свет'));
        custom(light.add(s.light, 'exposure', -2, 2, 0.05).name('Экспозиция, EV'));

        const output = gui.addFolder('Экспорт PNG без фона');
        output.add(s.output, 'longSide', { '2048 px': 2048, '4096 px': 4096, '6144 px': 6144, '8192 px': 8192 }).name('Размер').onChange(on('output'));
        output.add(s.output, 'shadow', options({ none: 'Без тени', with: 'С тенью на полу', separate: 'Тень отдельным файлом' })).name('Тень').onChange(on('output'));
        output.add({ save: () => actions.exportPNG() }, 'save').name('💾 Сохранить PNG');
        output.add({ copy: () => actions.copyPNG() }, 'copy').name('📋 Копировать в буфер');

        const view = gui.addFolder('Вид').close();
        view.add(s.view, 'backdrop', options({ studio: 'Студия', checker: 'Шахматка (прозрачность)', light: 'Светлый' })).name('Фон окна').onChange(on('view'));
        view.add({ reset: () => actions.resetView() }, 'reset').name('Сбросить камеру');
        view.add({ reset: () => actions.resetAll() }, 'reset').name('Сбросить все настройки');
        view.add({ version: `v${pkg.version}` }, 'version').name('Версия').disable();
    }

    refresh() { this.gui.controllersRecursive().forEach(c => c.updateDisplay()); }

    dispose() { this.gui.destroy(); }
}
