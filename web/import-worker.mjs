import {processFiles} from './import-processor.mjs';

// Dedicated module Worker: CPU-heavy parsing never blocks Android UI input.
self.addEventListener('message', async event => {
  const {id, files} = event.data || {};
  try {
    const result = await processFiles(files);
    self.postMessage({id, ok: true, result});
  } catch (error) {
    self.postMessage({id, ok: false, error: error?.message || 'Importation impossible.'});
  }
});
