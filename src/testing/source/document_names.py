"""User-facing document names, shared by Telegram and downloads."""
from datetime import date
from urllib.parse import quote


def period(data):
    start,end=data['from'],data['to']
    if data.get('from_original'):
        start,end=data['from_original'],data['to_original']
    elif data.get('id') or data.get('token'):
        dates=sorted({x['load_date'] for x in data.get('loads',[])})
        if not dates:return ''
        start,end=dates[0],dates[-1]
    values=[date.fromisoformat(x).strftime('%d.%m.%Y') for x in (start,end)]
    return values[0] if start==end else ' — '.join(values)


def title(data, summary=False, include_number=False):
    if summary:return 'Ведомость погрузочных работ'
    base='Наряд на сдельную оплату'
    if data.get('id'):return base+(' № '+str(data['id']) if include_number else '')
    return base+(' · к сдаче' if data.get('token') else ' за период')


def metadata(data, fmt='docx', summary=False):
    dates=period(data)
    caption=title(data,summary,include_number=True)+(('\nПериод: '+dates) if dates else '')
    if summary:stem='Ведомость'
    elif data.get('id'):stem='Наряд_№'+str(data['id'])
    elif data.get('token'):stem='Наряд_к_сдаче'
    else:stem='Наряд'
    if dates:stem+='_'+dates.replace(' — ','–')
    return stem+'.'+fmt,caption


def disposition(filename):
    return "attachment; filename*=UTF-8''"+quote(filename,safe='')


def backup_filename(day, clock=None):
    name='Резервная_копия_ГрузКонтроль_'+date.fromisoformat(day).strftime('%d.%m.%Y')
    return name+('_'+clock if clock else '')+'.sqlite3'
