from io import BytesIO
from docx import Document
from test_contractor import env
from loader_report import build_loader_docx
from test_app import a


def test_filtered_exports_match_stats_and_do_not_write(env):
    cl,req,products,crew,load,submit,rates,admin,lev,other=env
    load();load(transport='truck');submit()
    before=cl.get('/api/statements',headers=lev).json()
    for transport in ('all','wagon','truck'):
        params={'start':'2026-11-01','end':'2026-11-30','transport':transport}
        stats=cl.get('/api/manager-stats',headers=lev,params=params).json()
        for section in ('transport','products','days','people'):
            response=cl.get('/api/manager-stats/export/'+section,headers=lev,params=params)
            assert response.status_code==200,response.text
            doc=Document(BytesIO(response.content));table=doc.tables[0]
            expected=stats['totals']['amount_cents']
            actual=table.rows[-1].cells[-1].text
            assert actual==f'{expected/100:,.2f}'.replace(',',' ').replace('.',',')
            if transport=='truck':assert 'Наемник на тупике' not in '\n'.join(c.text for r in table.rows for c in r.cells)
        data=a.report_data(params['start'],params['end'])
        doc=Document(BytesIO(build_loader_docx(data,'',transport)))
        titles=' '.join(c.text for c in doc.tables[0].rows[0].cells)
        assert ('Вагоны' in titles)==(transport!='truck')
        assert ('Машины' in titles)==(transport!='wagon')
        assert doc.tables[0].rows[-1].cells[-1].text==actual
    assert cl.get('/api/statements',headers=lev).json()==before
    assert cl.get('/api/manager-stats/export/days',headers=other,params=params).status_code==403
    assert cl.get('/api/manager-stats/export/nope',headers=lev,params=params).status_code==400
    assert cl.get('/api/manager-stats/export/days',headers=lev,params={**params,'transport':'bad'}).status_code==400


def test_sections_sent_as_word_to_requesting_user(env,monkeypatch):
    cl,req,products,crew,load,submit,rates,admin,lev,other=env
    load();load(transport='truck')
    with a.db() as c:c.execute('UPDATE users SET started=1 WHERE tg_id=444')
    sent=[]
    class Telegram:
        def __init__(self,**kwargs):pass
        async def __aenter__(self):return self
        async def __aexit__(self,*args):pass
        async def post(self,url,**kwargs):
            sent.append(kwargs)
            class Result:
                def raise_for_status(self):pass
                def json(self):return {'ok':True}
            return Result()
    monkeypatch.setattr(a.httpx,'AsyncClient',Telegram)
    for transport in ('all','wagon','truck'):
        for section in ('transport','products','days','people'):
            payload=dict(stats_section=section,start='2026-11-01',end='2026-11-30',transport=transport)
            response=cl.post('/api/report/send/docx',headers=lev,json=payload)
            assert response.status_code==200,response.text
            msg=sent[-1];assert msg['data']['chat_id']=='444'
            filename,content,mime=msg['files']['document']
            assert filename.endswith('.docx') and 'wordprocessingml' in mime
            doc=Document(BytesIO(content));assert doc.tables
            download=cl.get('/api/manager-stats/export/'+section,headers=lev,params={k:v for k,v in payload.items() if k!='stats_section'})
            expected=Document(BytesIO(download.content))
            assert [[c.text for c in r.cells] for r in doc.tables[0].rows]==[[c.text for c in r.cells] for r in expected.tables[0].rows]
    assert len(sent)==12
