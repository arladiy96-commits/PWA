from io import BytesIO
from docx import Document
from test_contractor import env
from test_app import a

def test_person_report_matches_ledger_and_preserves_data(env,monkeypatch):
    cl,req,products,crew,load,submit,rates,admin,lev,other=env
    load();load(transport='truck');submit()
    with a.db() as c:
        c.execute('UPDATE users SET started=1 WHERE tg_id=444')
        person=c.execute('SELECT id FROM loaders ORDER BY id').fetchone()[0]
    before=cl.get('/api/statements',headers=lev).json()
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
    for person_id in (person,0):
        for transport in ('all','wagon','truck'):
            params=dict(start='2026-11-01',end='2026-11-30',transport=transport)
            ledger=cl.get(f'/api/loader-ledger/{person_id}',headers=lev,params=params).json()
            res=cl.post('/api/report/send/docx',headers=lev,json=dict(person_id=person_id,**params))
            assert res.status_code==200,res.text
            msg=sent[-1]
            assert msg['data']['chat_id']=='444'
            doc=Document(BytesIO(msg['files']['document'][1]))
            table=doc.tables[0]
            text='\n'.join(c.text for r in table.rows for c in r.cells)
            assert ledger['person']['name'] in doc.paragraphs[0].text
            assert len(table.rows)==2+len(ledger['items'])+2*len({x['load_date'] for x in ledger['items']})+(not ledger['items'])
            for i,key in enumerate(('earned_cents','paid_cents','balance_cents'),3):
                expected=f'{ledger[key]/100:,.2f}'.replace(',',' ').replace('.',',')
                assert table.rows[-1].cells[i].text==expected
            if ledger['items']:
                assert '02.11.2026' in text
                assert 'Итого за день' in text
                assert ('Без деления на бригаду' in text)==(person_id==0)
    assert cl.get('/api/statements',headers=lev).json()==before
    assert cl.post('/api/report/send/docx',headers=other,json=dict(person_id=person,**params)).status_code==403
    for bad in ('1',-1,True):
        assert cl.post('/api/report/send/docx',headers=lev,json=dict(person_id=bad,**params)).status_code==400
    assert cl.post('/api/report/send/docx',headers=lev,json=dict(person_id=999999,**params)).status_code==404

def test_corrections_use_saved_personal_amount():
    from loader_report import build_person_docx
    x=dict(load_id=1,load_date='2026-11-02',transport='wagon',reference='12345678',product_name='Мука',
           tonnes='68.5',status='loaded',deleted=0,crew_member=1,crew_count=3,rate_snapshot='100',
           total_cents=10000,earned_cents=3334,paid_cents=3500,balance_cents=-166)
    data=dict(person={'name':'Тест'},items=[x],earned_cents=3334,paid_cents=3500,balance_cents=-166)
    doc=Document(BytesIO(build_person_docx(data,'2026-11-01','2026-11-30')))
    text=' '.join(c.text for r in doc.tables[0].rows for c in r.cells)
    assert '33,34' in text and '-1,66' in text and 'Корректировка к сдаче' in text
    x.update(deleted=1,earned_cents=0,balance_cents=-3500)
    doc=Document(BytesIO(build_person_docx(data,'2026-11-01','2026-11-30')))
    assert 'Погрузка удалена' in ' '.join(c.text for r in doc.tables[0].rows for c in r.cells)
