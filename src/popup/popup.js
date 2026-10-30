/*
 * Popup: reads and writes settings. Open Google tabs pick up changes through
 * storage.onChanged on their own; no messaging is involved.
 */
(function () {
  'use strict';

  const { settings } = globalThis.NoAI;

  const $ = (id) => document.getElementById(id);
  const switches = [...document.querySelectorAll('input[data-setting]')];
  const features = $('features');
  const imageMode = $('imageMode');
  const imageQueryExclude = $('imageQueryExclude');
  const status = $('status');

  let state = { ...settings.DEFAULTS };

  function render() {
    for (const input of switches) input.checked = !!state[input.dataset.setting];
    for (const radio of imageMode.querySelectorAll('input')) radio.checked = radio.value === state.imageMode;
    // Disabled, not changed: sub-settings keep their values while master is off.
    features.disabled = !state.master;
    imageMode.disabled = !state.master || !state.images;
    // imageQueryExclude only meaningful when images feature is active.
    if (imageQueryExclude) imageQueryExclude.disabled = !state.master || !state.images;
  }

  function update(partial) {
    state = settings.normalize({ ...state, ...partial });
    render();
    status.textContent = '';
    settings.save(partial).catch(() => {
      status.textContent = 'Couldn’t save settings. Please try again.';
    });
  }

  for (const input of switches) {
    input.addEventListener('change', () => update({ [input.dataset.setting]: input.checked }));
  }
  imageMode.addEventListener('change', (event) => {
    if (event.target.name === 'imageMode') update({ imageMode: event.target.value });
  });

  render();
  settings.load().then((loaded) => {
    state = loaded;
    render();
    settings.watch(loaded, (next) => {
      state = next;
      render();
    });
  });
})();
