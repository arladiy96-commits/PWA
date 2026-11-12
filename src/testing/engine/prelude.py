# Browser-only HTTP boundary. No web server, credentials or Telegram transport.
import sys, types
from pathlib import Path
class HTTPException(Exception):
    def __init__(self, status_code, detail):
        self.status_code, self.detail = status_code, detail
        super().__init__(detail)
class Request:
    def __init__(self, body): self.body = body
    async def json(self): return self.body
class Response:
    def __init__(self, content, media_type='application/json', headers=None, status_code=200):
        self.content,self.media_type,self.headers,self.status_code=content,media_type,headers or {},status_code
class Router:
    def __init__(self): self.routes=[]
    def __getattr__(self, method):
        def route(path):
            def register(fn): self.routes.append((method.upper(),path,fn));return fn
            return register
        return route
app=Router()
def Depends(fn): return None
def active(): pass
def current_user(): pass
# contractor.py depends only on HTTPException; keep its source unchanged.
fastapi=types.ModuleType('fastapi');fastapi.HTTPException=HTTPException
sys.modules['fastapi']=fastapi
DB_PATH=Path('/data/test.sqlite3')
BOT_TOKEN=''
PUBLIC_URL=''
ADMIN_TG_ID=111
