"""Period summary: full work participation and each loader's saved earnings."""
from datetime import date
from decimal import Decimal
from io import BytesIO


def summary_rows(data):
    products = ['Отруби', 'Мука']
    products += sorted({d['product_name'] for d in data['details']} - set(products))
    people = {}
    for d in data['details']:
        person = people.setdefault(d['loader_id'], {'is_contractor': d.get('is_contractor',False), 'name': d['loader_name'], 'amount_cents': 0, 'volumes': {}})
        key = (d['transport'], d['product_name'])
        person['volumes'][key] = person['volumes'].get(key, Decimal(0)) + (1 if d['transport'] == 'wagon' else Decimal(d['tonnes']))
        person['amount_cents'] += d['amount_cents']
    return products, sorted(people.values(), key=lambda p: (p['is_contractor'],p['name'].casefold()))


def build_loader_docx(data, generated_at, transport="all"):
    if transport not in ("all", "wagon", "truck"):
        raise ValueError("Invalid transport")
    if transport != "all":
        data = {**data, "details": [x for x in data["details"] if x["transport"] == transport]}
    # Match the existing payment report: no optional Word libraries on the server.
    from zipfile import ZipFile, ZIP_DEFLATED
    from xml.sax.saxutils import escape

    products, people = summary_rows(data)
    columns = [(t, p) for t in ('wagon', 'truck') if transport in ('all',t) for p in products]
    def paragraph(text, bold=False, size=24, align='left', after=0):
        runs = []
        for i, line in enumerate(str(text).split('\n')):
            if i: runs.append('<w:r><w:br/></w:r>')
            runs.append('<w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/>'
                        f'<w:sz w:val="{size}"/>' + ('<w:b/>' if bold else '') +
                        '</w:rPr><w:t xml:space="preserve">' + escape(line) + '</w:t></w:r>')
        return f'<w:p><w:pPr><w:jc w:val="{align}"/><w:spacing w:after="{after}"/></w:pPr>' + ''.join(runs) + '</w:p>'
    def number(n): return format(Decimal(n).normalize(), 'f').replace('.', ',')
    def cash(n): return f'{Decimal(n)/100:,.2f}'.replace(',', ' ').replace('.', ',')
    period = ' — '.join(date.fromisoformat(data[k]).strftime('%d.%m.%Y') for k in ('from','to'))
    body = paragraph(data.get('_title','Ведомость погрузочных работ'), True, 36, 'center', 240)
    body += paragraph('Период: ' + period, after=200)
    if transport != 'all':
        body += paragraph('Транспорт: ' + {'all':'Весь транспорт','wagon':'Вагоны','truck':'Машины'}[transport], after=200)
    for text in data.get('_intro', []):
        body += paragraph(text, after=120)
    headers = ['Грузчик'] + [('Вагоны' if t == 'wagon' else 'Машины') + '\n' + p.lower() + (', шт.' if t == 'wagon' else ', т') for t,p in columns] + ['Заработано, ₸']
    records = [[p['name']] + [number(p['volumes'].get(k,0)) for k in columns] + [cash(p['amount_cents'])] for p in people]
    records.append(['Итого'] + ['—'] * len(columns) + [cash(sum(p['amount_cents'] for p in people))])
    widths = [3685] + [8844 // len(columns)] * len(columns) + [2835]
    if data.get('_table'):
        headers,records,widths = data['_table']
    borders = ''.join(f'<w:{side} w:val="single" w:sz="4" w:color="999999"/>' for side in ('top','left','bottom','right','insideH','insideV'))
    body += f'<w:tbl><w:tblPr><w:tblW w:w="{sum(widths)}" w:type="dxa"/><w:tblLayout w:type="fixed"/><w:tblBorders>{borders}</w:tblBorders><w:tblCellMar><w:top w:w="150" w:type="dxa"/><w:bottom w:w="150" w:type="dxa"/><w:left w:w="80" w:type="dxa"/><w:right w:w="80" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>'
    body += ''.join(f'<w:gridCol w:w="{w}"/>' for w in widths) + '</w:tblGrid>'
    for i, record in enumerate([headers] + records):
        body += '<w:tr><w:trPr><w:cantSplit/>' + ('<w:tblHeader/>' if i == 0 else '') + '</w:trPr>'
        if isinstance(record, dict) and 'date' in record:
            body += f'<w:tc><w:tcPr><w:tcW w:w="{sum(widths)}" w:type="dxa"/><w:gridSpan w:val="{len(widths)}"/><w:shd w:fill="E7EBEF"/></w:tcPr>'
            body += paragraph(record['date'], bold=True).replace('<w:pPr>', '<w:pPr><w:keepNext/>')
            body += '</w:tc></w:tr>'
            continue
        for j, (value, width) in enumerate(zip(record,widths)):
            body += f'<w:tc><w:tcPr><w:tcW w:w="{width}" w:type="dxa"/><w:vAlign w:val="center"/>' + ('<w:shd w:fill="E7EBEF"/>' if i == 0 else '') + '</w:tcPr>'
            body += paragraph(value, i in (0,len(records)), align='left' if j == 0 else 'center' if i == 0 else 'right') + '</w:tc>'
        body += '</w:tr>'
    body += '</w:tbl>'
    body += '<w:sectPr><w:pgSz w:w="16838" w:h="11906" w:orient="landscape"/><w:pgMar w:top="737" w:right="737" w:bottom="737" w:left="737" w:header="0" w:footer="0"/></w:sectPr>'
    document = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' + body + '</w:body></w:document>'
    types = '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
    rels = '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'
    out = BytesIO()
    with ZipFile(out, 'w', ZIP_DEFLATED) as z:
        z.writestr('[Content_Types].xml', types)
        z.writestr('_rels/.rels', rels)
        z.writestr('word/document.xml', document)
    return out.getvalue()


STAT_TITLES = {'transport':'По транспорту','products':'По продукции','days':'По дням','people':'Начисления по грузчикам'}

def build_stats_docx(stats, section, transport='all'):
    if section not in STAT_TITLES:
        raise ValueError('Invalid section')
    cash=lambda n: f'{Decimal(n)/100:,.2f}'.replace(',', ' ').replace('.', ',')
    num=lambda n: format(Decimal(n).normalize(),'f').replace('.', ',')
    if section=='people':
        people=sorted(stats['people'],key=lambda p:p['loader_id']==0)
        headers=['Получатель','Погрузок','Начислено, ₸']
        records=[[p['name'],str(p['loads']),cash(p['amount_cents'])] for p in people]
        records.append(['Итого','—',cash(sum(p['amount_cents'] for p in people))])
        widths=[7500,2500,5364]
    else:
        if section=='transport':
            items=[dict(stats['transport'][t],name=n) for t,n in [('wagon','Вагоны'),('truck','Машины')] if transport in ('all',t)]
        else: items=stats[section]
        headers=[{'transport':'Транспорт','products':'Продукция','days':'Дата'}[section],'Шт.','Тонн','Затраты, ₸']
        records=[[date.fromisoformat(p['date']).strftime('%d.%m.%Y') if section=='days' else p['name'],str(p['loaded']),num(p['tonnes']),cash(p['amount_cents'])] for p in items]
        records.append(['Итого',str(sum(p['loaded'] for p in items)),num(sum((Decimal(p['tonnes']) for p in items),Decimal(0))),cash(sum(p['amount_cents'] for p in items))])
        widths=[5500,1800,3000,5064]
    return build_loader_docx({'from':stats['start'],'to':stats['end'],'details':[], '_title':STAT_TITLES[section], '_table':(headers,records,widths)},'',transport)


def build_person_docx(ledger, start, end, transport='all'):
    """Read-only explanation of the same saved amounts as the person's ledger."""
    from itertools import groupby
    cash = lambda n: f'{Decimal(n)/100:,.2f}'.replace(',', ' ').replace('.', ',')
    num = lambda n: format(Decimal(str(n or 0)).normalize(), 'f').replace('.', ',')
    records = []
    items = sorted(ledger['items'], key=lambda x: (x['load_date'], x['load_id']))
    for day, group in groupby(items, key=lambda x: x['load_date']):
        loads = list(group)
        records.append({'date': date.fromisoformat(day).strftime('%d.%m.%Y')})
        for x in loads:
            title = ('Вагон № ' + (x.get('reference') or '—') if x['transport']=='wagon'
                     else 'КамАЗ' if x.get('vehicle_kind')=='kamaz' else 'Фура')
            title += '\n' + x['product_name']
            if x.get('buyer'): title += '\nПокупатель: ' + x['buyer']
            active = x['status']=='loaded' and not x.get('deleted') and x.get('crew_member',1)!=0
            if not active:
                calculation = 'Начисление отменено'
                calculation += ('\nПогрузка удалена' if x.get('deleted') else
                                '\nПогрузка открыта заново' if x['status']!='loaded' else
                                '\nГрузчик снят с бригады')
            elif x.get('is_contractor'):
                calculation = num(x['rate_snapshot']) + ' ₸ за вагон\nБез деления на бригаду'
            else:
                calculation = (num(x['rate_snapshot']) + ' ₸ за вагон' if x['transport']=='wagon'
                               else num(x['tonnes']) + ' т × ' + num(x['rate_snapshot']) + ' ₸/т')
                calculation += '\nФонд: ' + cash(x['total_cents']) + ' ₸'
                calculation += '\nБригада: ' + str(x['crew_count']) + ' чел.'
                calculation += '\nДоля: фонд ÷ ' + str(x['crew_count'])
            if x['balance_cents']<0: calculation += '\nКорректировка к сдаче'
            records.append([title,num(x['tonnes']),calculation,cash(x['earned_cents']),
                            cash(x['paid_cents']),cash(x['balance_cents'])])
        records.append(['Итого за день','',''] + [cash(sum(x[k] for x in loads)) for k in
                       ('earned_cents','paid_cents','balance_cents')])
    if not items: records.append(['За период начислений нет','','','','',''])
    records.append(['Итого за период','',''] + [cash(ledger[k]) for k in
                   ('earned_cents','paid_cents','balance_cents')])
    intro = [
        'Начислено: ' + cash(ledger['earned_cents']) + ' ₸; в сданных ведомостях: ' +
        cash(ledger['paid_cents']) + ' ₸; осталось сдать: ' + cash(ledger['balance_cents']) + ' ₸.',
    ]
    return build_loader_docx({'from':start,'to':end,'details':[],
        '_title':'Отчёт по получателю: ' + ledger['person']['name'], '_intro':intro,
        '_table':(['Погрузка / продукция','Вес, т','Расчёт','Начислено, ₸',
                   'В сданных ведомостях, ₸','Осталось сдать, ₸'],
                  records,[3500,1100,4400,2100,2164,2100])}, '', transport)
