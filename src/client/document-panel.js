function fileName(disposition) {
  const encoded = disposition.match(/(?:^|;)\s*filename\*=UTF-8''([^;]+)/i);
  if (encoded) {
    try { return decodeURIComponent(encoded[1].trim()); } catch {}
  }
  const plain = disposition.match(/(?:^|;)\s*filename=(?:"([^"]+)"|([^;]+))/i);
  return (plain?.[1] || plain?.[2]?.trim() || 'ГрузКонтроль.docx');
}

let currentPanel;

export async function showDocument(response) {
  const name = fileName(response.headers.get('Content-Disposition') || '');
  const blob = await response.blob();
  const file = new File([blob], name, {type: blob.type});
  const url = URL.createObjectURL(blob);
  const panel = document.createElement('aside');
  panel.id = 'pwa-document';
  panel.setAttribute('aria-label', 'Документ готов');
  panel.innerHTML = `<div class="pwa-document-head">
    <div><b>Документ готов</b><div class="pwa-document-name"></div></div>
    <button type="button" class="pwa-document-close" aria-label="Закрыть">×</button>
  </div>
  <div class="pwa-document-actions">
    <a>Сохранить / открыть</a>
    <button type="button" class="pwa-document-share" hidden>Поделиться</button>
  </div>
  <div class="pwa-document-message" role="status" hidden></div>`;

  panel.querySelector('.pwa-document-name').textContent = name;
  const link = panel.querySelector('a');
  link.href = url;
  link.download = name;
  const share = panel.querySelector('.pwa-document-share');
  const message = panel.querySelector('.pwa-document-message');
  const shareData = {files: [file]};
  share.hidden = !navigator.share || !navigator.canShare?.(shareData);
  share.onclick = async () => {
    share.disabled = true;
    message.hidden = true;
    try {
      await navigator.share(shareData);
    } catch (error) {
      if (error.name !== 'AbortError') {
        message.textContent = 'Не удалось открыть меню. Файл можно сохранить кнопкой рядом.';
        message.hidden = false;
      }
    } finally {
      share.disabled = false;
    }
  };

  const remove = () => {
    panel.remove();
    URL.revokeObjectURL(url);
    currentPanel = undefined;
  };
  panel.querySelector('.pwa-document-close').onclick = remove;
  currentPanel?.();
  currentPanel = remove;
  document.body.append(panel);
}
