import './style.css';
import { App } from './app/App';

const viewport = document.getElementById('viewport')!;
const panel = document.getElementById('panel')!;
const status = viewport.querySelector('.toast')!;

let app: App | undefined;
try {
    app = new App(viewport, panel);
    void app.start(`${import.meta.env.BASE_URL}Flag.svg`);
} catch (error) {
    console.error(error);
    status.textContent = error instanceof Error ? error.message : String(error);
    status.classList.add('visible', 'error');
}

if (import.meta.hot) import.meta.hot.dispose(() => app?.dispose());
