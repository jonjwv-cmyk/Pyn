/**
 * Preload для webview «Волна» (SoundCloud).
 * contextBridge → main world; inject патчит window.open и шлёт URL сюда →
 * sendToHost → WaveScreen → pyn:wave:open-auth.
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('__pynWave', {
  openAuth: function openAuth(url) {
    try {
      ipcRenderer.sendToHost('pyn-wave-open', String(url || ''));
    } catch (e) {
      /* */
    }
  },
});
