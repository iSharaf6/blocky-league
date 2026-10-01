import './boot.css';

// Keep a usable loading screen even if the game bundle fails to download or WebGL cannot initialize.
void import('./main').then(({ ready }) => ready).catch((error: unknown) => {
  console.error('Blocky League could not start:', error);
  const boot = document.getElementById('boot');
  const status = document.getElementById('boot-status');
  if (!boot || !status) return;
  boot.classList.remove('gone');
  boot.classList.add('failed');
  boot.setAttribute('aria-busy', 'false');
  status.textContent = 'The game could not start. Check your connection and try reloading. If it keeps happening, use a browser with WebGL enabled.';
  const retry = document.createElement('button');
  retry.className = 'boot-retry';
  retry.textContent = 'RELOAD GAME';
  retry.addEventListener('click', () => location.reload());
  status.append(retry);
});
