/**
 * The entry point.
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { loadCatalog } from './media/catalog';
import { resolveSeed } from './media/shuffle';
import './styles/app.css';

const root = createRoot(document.getElementById('root')!);

function render(items: Awaited<ReturnType<typeof loadCatalog>>['items'], seed: number) {
  root.render(
    <StrictMode>
      <App items={items} seed={seed} />
    </StrictMode>,
  );
}

const seed = resolveSeed();

loadCatalog()
  .then(({ items }) => render(items, seed))
  .catch((error: unknown) => {
    console.error(error);
    const container = document.getElementById('root')!;
    container.innerHTML = `
      <main class="atlas-app">
        <div class="canvas-empty">
          <h2>The catalog could not be loaded</h2>
          <p>${error instanceof Error ? error.message : 'Unknown error'}</p>
          <p>Run <code>npm run assets:build</code> to generate <code>public/local/catalog.json</code>.</p>
        </div>
      </main>`;
  });
