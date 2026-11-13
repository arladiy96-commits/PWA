const launch = document.getElementById('pwa-launch');

if (launch) {
  const video = launch.querySelector('video');
  const request = new AbortController();
  let videoUrl;
  let timeout;

  const dismiss = () => {
    request.abort();
    clearTimeout(timeout);
    video.pause();
    video.removeAttribute('src');
    if (videoUrl) URL.revokeObjectURL(videoUrl);
    launch.remove();
  };

  async function playLaunch() {
    try {
      // Fetch the full asset through the app cache. Blob playback lets Safari
      // seek locally without sending HTTP range requests to the service worker.
      const response = await fetch(new URL('./launch.mp4', import.meta.url), {signal: request.signal});
      if (!response.ok) throw new Error('Launch video unavailable');
      const blob = await response.blob();
      if (request.signal.aborted) return;
      videoUrl = URL.createObjectURL(blob);
      video.muted = true;
      video.src = videoUrl;
      await video.play();
    } catch {
      dismiss();
    }
  }

  if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
    dismiss();
  } else {
    video.addEventListener('ended', dismiss, {once: true});
    video.addEventListener('error', dismiss, {once: true});
    launch.addEventListener('animationend', dismiss, {once: true});
    window.addEventListener('pageshow', event => {
      if (event.persisted) dismiss();
    });
    timeout = setTimeout(dismiss, 4800);
    playLaunch();
  }
}
