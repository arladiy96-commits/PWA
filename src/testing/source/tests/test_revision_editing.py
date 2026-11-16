from test_contractor import env
from test_app import a
from document_names import period


def test_rollback_is_normal_pending_and_accepts_new_loads(env):
    cl,req,products,crew,load,submit,rates,adm,lev,other=env
    rates();lid=load();sid=submit()
    old=req('GET',f'/api/statements/{sid}')
    req('POST',f'/api/admin/statements/{sid}/cancel')
    initial=req('GET','/api/statements/pending',h=lev)
    assert initial['id']==sid and initial['cancelled']
    new_person=req('POST','/api/loaders',{'name':'Новый грузчик'})['id']
    req('PATCH',f'/api/loads/{lid}',{'crew':crew+[new_person]})
    wagon=load(day='2026-11-03')
    truck=load(transport='truck',day='2026-11-03')
    assert cl.post('/api/statements',headers=lev,json={'token':initial['token']}).status_code==409
    a.init_db()  # Open state and date survive a restart.
    d=req('GET','/api/settlement-overview',h=lev)['pending']
    assert {x['id'] for x in d['loads']}=={lid,wagon,truck}
    assert {x['loader_id'] for x in d['details'] if x['load_id']==lid and not x.get('is_contractor')}==set(crew+[new_person])
    assert sum(x['amount_cents'] for x in d['details'] if x.get('is_contractor'))==120000
    assert period(d)==period(old)
    body={'token':d['token']}
    assert req('POST','/api/statements',body,h=lev)['id']==sid
    assert req('POST','/api/statements',body,h=lev)['id']==sid
    final=req('GET',f'/api/statements/{sid}')
    for key in ('id','created_at','from','to'):assert final[key]==old[key]
    assert final['stats']['total_cents']==5820000
    assert not req('GET','/api/statements/pending')['details']
    late=load(day='2026-11-04')
    assert {x['id'] for x in req('GET','/api/statements/pending')['loads']}=={late}
    assert submit()!=sid


def test_zero_accrual_original_stays_editable(env):
    cl,req,products,crew,load,submit,rates,adm,lev,other=env
    rates();lid=load();sid=submit()
    req('POST',f'/api/admin/statements/{sid}/cancel')
    stale=req('GET','/api/statements/pending')
    req('PATCH',f'/api/loads/{lid}',{'crew':[]})
    empty=req('GET','/api/statements/pending')
    assert not empty['details']
    assert empty['revision_loads'][0]['id']==lid
    assert cl.post('/api/statements',headers=lev,json={'token':stale['token']}).status_code==409
