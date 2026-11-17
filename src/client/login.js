const loginMessages = {
  400: 'Проверь логин и пароль.',
  401: 'Неверный логин или пароль.',
  403: 'Доступ закрыт. Обратись к администратору.',
  422: 'Проверь логин и пароль.',
  429: 'Слишком много попыток. Попробуй чуть позже.',
  invalidResponse: 'Сервер не подтвердил вход. Попробуй позже.'
};

export function showLogin(app, {signIn, expired, demo}) {
  document.documentElement.classList.add('pwa-login-page');
  app.innerHTML = `
    <section class="pwa-login" aria-labelledby="login-title">
      <header class="pwa-login-brand">
        <img src="${new URL('../icons/gruzcontrol-180.png', import.meta.url)}" width="48" height="48" alt="">
        <p>ГрузКонтроль</p>
      </header>
      <div class="pwa-login-card">
        <h1 id="login-title">Вход в кабинет</h1>
        <p class="pwa-login-hint">${demo
          ? 'Войди в офлайн-кабинет под тестовой учётной записью.'
          : 'Введи логин и пароль, которые выдал администратор.'}</p>
        <form id="login">
          <label for="login-name">Логин</label>
          <input id="login-name" name="login" autocomplete="${demo ? 'off' : 'username'}" autocapitalize="none" spellcheck="false" enterkeyhint="next" required>
          <label for="login-password">Пароль</label>
          <div class="pwa-login-password">
            <input id="login-password" name="password" type="password" autocomplete="${demo ? 'off' : 'current-password'}" autocapitalize="none" spellcheck="false" enterkeyhint="go" required>
            <button type="button" aria-controls="login-password" aria-label="Показать пароль">Показать</button>
          </div>
          <p class="pwa-login-error" role="alert"></p>
          <p class="pwa-login-status" role="status">${expired ? 'Сеанс закончился. Войди снова.' : ''}</p>
          <button type="submit" class="pwa-login-submit">Войти</button>
        </form>
      </div>
      ${demo ? `
        <details class="pwa-login-demo">
          <summary>Демо-логины</summary>
          <ul>${demo.accounts.map(account => `<li><span>${account.label}</span><code>${account.login}</code></li>`).join('')}</ul>
          <p>Общий пароль <code>${demo.password}</code></p>
        </details>` : ''}
    </section>`;

  const form = app.querySelector('#login');
  const login = form.elements.login;
  const password = form.elements.password;
  const toggle = form.querySelector('[type="button"]');
  const submit = form.querySelector('[type="submit"]');
  const error = form.querySelector('[role="alert"]');
  const status = form.querySelector('[role="status"]');

  function setPasswordVisible(visible) {
    password.type = visible ? 'text' : 'password';
    toggle.textContent = visible ? 'Скрыть' : 'Показать';
    toggle.setAttribute('aria-label', visible ? 'Скрыть пароль' : 'Показать пароль');
  }

  toggle.addEventListener('click', () => setPasswordVisible(password.type === 'password'));
  form.addEventListener('input', () => {
    error.textContent = '';
    login.removeAttribute('aria-invalid');
    password.removeAttribute('aria-invalid');
  });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (submit.disabled) return;
    error.textContent = '';
    if (!login.value.trim()) {
      error.textContent = 'Введи логин.';
      login.setAttribute('aria-invalid', 'true');
      login.focus();
      return;
    }

    const credentials = {login: login.value.trim(), password: password.value};
    setPasswordVisible(false);
    submit.disabled = true;
    login.readOnly = true;
    password.readOnly = true;
    status.textContent = 'Проверяем данные…';

    try {
      const result = await signIn(credentials);
      if (result === 401) {
        login.setAttribute('aria-invalid', 'true');
        password.setAttribute('aria-invalid', 'true');
      }
      if (result) {
        error.textContent = loginMessages[result] || 'Сервер сейчас не может выполнить вход. Попробуй позже.';
      }
    } catch (err) {
      error.textContent = err.name === 'TimeoutError' ? 'Сервер долго не отвечает. Попробуй ещё раз.'
        : err.name === 'SecurityError' || err.name === 'QuotaExceededError' ? 'Не удалось сохранить сеанс. Проверь настройки браузера.'
        : 'Нет связи с сервером. Проверь интернет и попробуй ещё раз.';
    } finally {
      status.textContent = '';
      login.readOnly = false;
      password.readOnly = false;
      submit.disabled = false;
    }
  });
}
