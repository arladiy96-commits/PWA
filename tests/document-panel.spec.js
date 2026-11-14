import {test, expect} from '@playwright/test';

test('exports open the system share menu when file sharing is available', async ({page}) => {
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.goto('/');
  await expect(page.locator('#pwa-build')).toHaveText(/Сборка: [a-f0-9]{8}/);
  await page.evaluate(async () => {
    const type = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    const filename = 'Ведомость 14.11.2026.docx';
    window.prepareDocument = () => window.PWA.download(new Response('Word content', {
      headers: {'Content-Type': type, 'Content-Disposition': "attachment; filename*=UTF-8''"+encodeURIComponent(filename)}
    }));
    Object.defineProperties(navigator, {
      canShare: {configurable:true, value: ({files}) => files[0].type === type},
      share: {configurable:true, value: async ({files}) => {
        window.sharedFile = {name: files[0].name, type: files[0].type, body: await files[0].text()};
        throw new DOMException('Cancelled','AbortError');
      }}
    });
    await window.prepareDocument();
  });
  const panel = page.locator('#pwa-document');
  const name = 'Ведомость 14.11.2026.docx';
  await expect(panel.getByRole('link',{name:'Сохранить / открыть'})).toHaveAttribute('download', name);
  await panel.getByRole('button',{name:'Поделиться'}).click();
  expect(await page.evaluate(() => window.sharedFile)).toEqual({
    name, type:'application/vnd.openxmlformats-officedocument.wordprocessingml.document', body:'Word content'
  });
  await expect(panel.getByRole('status')).toBeHidden();
  await panel.getByRole('button',{name:'Закрыть'}).click();
  await expect(panel).toHaveCount(0);

  await page.evaluate(async () => {
    Object.defineProperty(navigator,'canShare',{value:()=>false});
    await window.prepareDocument();
  });
  await expect(panel.getByRole('button',{name:'Поделиться'})).toBeHidden();
  await expect(panel.getByRole('link',{name:'Сохранить / открыть'})).toBeVisible();
});
