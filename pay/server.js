// Hostinger / hPanel entry file. "Entry file" mein server.js rakho.
process.removeAllListeners('warning');
process.on('warning', w => { if (w.name !== 'ExperimentalWarning') console.warn(w); });
require('./src/server');
