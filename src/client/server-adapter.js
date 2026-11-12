/* Production transport only: never imports the test adapter or evaluates domain rules. */
export function createServerAdapter(config,token){
  const base=new URL(config.apiBase);
  if(base.protocol!=='https:')throw Error('Адрес сервера должен начинаться с HTTPS');
  return {
    async fetch(path,opts={}){
      if(!path.startsWith('/api/'))throw Error('Недопустимый путь API');
      const headers=new Headers(opts.headers);headers.delete('X-Telegram-Init-Data');
      if(token)headers.set('Authorization','Bearer '+token);
      if(opts.body)headers.set('Content-Type','application/json');
      try {
        const response=await fetch(new URL(path,base),{...opts,headers,cache:'no-store',credentials:'omit'});
        if(response.status===401)window.dispatchEvent(new Event('pwa-session-expired'));
        return response;
      }catch(e){if(e.name==='AbortError')throw e;throw Error('Нет связи с сервером. Изменения не сохранены. Проверь соединение и повтори действие.');}
    }
  };
}
