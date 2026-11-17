export function createAppDialogs(navigation) {
  const dialog = document.createElement('dialog');
  dialog.id = 'pwa-dialog';
  dialog.setAttribute('aria-labelledby', 'pwa-dialog-title');
  dialog.setAttribute('aria-describedby', 'pwa-dialog-message');
  dialog.innerHTML = `
    <form>
      <h2 id="pwa-dialog-title"></h2>
      <p id="pwa-dialog-message"></p>
      <input hidden disabled>
      <div class="pwa-dialog-actions">
        <button type="button" class="btn pwa-dialog-cancel">Отмена</button>
        <button type="submit" class="btn primary pwa-dialog-accept"></button>
      </div>
    </form>`;
  document.body.append(dialog);

  const title = dialog.querySelector('h2');
  const message = dialog.querySelector('p');
  const form = dialog.querySelector('form');
  const input = dialog.querySelector('input');
  const cancel = dialog.querySelector('.pwa-dialog-cancel');
  const accept = dialog.querySelector('.pwa-dialog-accept');
  let active;

  async function finish(accepted, fromNavigation = false) {
    if (!active) return;
    const { resolve, withInput } = active;
    active = null;
    const value = withInput ? (accepted ? input.value : null) : accepted;
    if (dialog.open) dialog.close();
    if (!fromNavigation) await navigation.close('app-dialog');
    resolve(value);
  }

  form.addEventListener('submit', event => {
    event.preventDefault();
    finish(true);
  });
  cancel.addEventListener('click', () => finish(false));
  dialog.addEventListener('cancel', event => {
    event.preventDefault();
    finish(false);
  });
  dialog.addEventListener('click', event => {
    if (event.target === dialog) finish(false);
  });

  function open(options, withInput) {
    if (active) return Promise.resolve(withInput ? null : false);
    title.textContent = options.title;
    message.textContent = options.message ?? '';
    message.hidden = !options.message;
    if (message.hidden) dialog.removeAttribute('aria-describedby');
    else dialog.setAttribute('aria-describedby', message.id);
    accept.textContent = options.confirmLabel ?? (withInput ? 'Сохранить' : 'Подтвердить');
    accept.classList.toggle('is-danger', Boolean(options.danger));
    input.hidden = input.disabled = !withInput;
    input.setAttribute('aria-label', options.title);
    input.value = withInput ? options.value ?? '' : '';
    input.autofocus = withInput;
    cancel.autofocus = !withInput;
    return new Promise(resolve => {
      active = { resolve, withInput };
      dialog.showModal();
      navigation.layer('app-dialog', () => finish(false, true));
    });
  }

  return {
    confirmAction: options => open(options, false),
    askText: options => open(options, true),
  };
}
