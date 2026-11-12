"""Word payment order built with Python standard library only."""
import io
import document_names
import contractor
from datetime import date
from decimal import Decimal
from zipfile import ZipFile, ZIP_DEFLATED
from xml.sax.saxutils import escape


def build_docx(data):
    def cash(c):return f'{Decimal(c)/100:,.2f}'.replace(',',' ').replace('.',',')
    def number(x):return format(Decimal(x or '0').normalize(),'f').replace('.',',')
    def paragraph(text,bold=False,size=18,align='left',after=0,before=0,keep=False):
        props=f'<w:jc w:val="{align}"/><w:spacing w:before="{before}" w:after="{after}"/>'
        if keep:props+='<w:keepNext/>'
        runs=[]
        for i,line in enumerate(str(text).split('\n')):
            if i:runs.append('<w:r><w:br/></w:r>')
            runs.append(f'<w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/><w:sz w:val="{size}"/>'+('<w:b/>' if bold else '')+f'</w:rPr><w:t xml:space="preserve">{escape(line)}</w:t></w:r>')
        return '<w:p><w:pPr>'+props+'</w:pPr>'+''.join(runs)+'</w:p>'
    def table(headers,widths,records):
        borders=''.join(f'<w:{side} w:val="single" w:sz="5" w:color="D9D9D9"/>' for side in ['top','left','bottom','right','insideH','insideV'])
        out=f'<w:tbl><w:tblPr><w:tblW w:w="{sum(widths)}" w:type="dxa"/><w:tblLayout w:type="fixed"/><w:tblBorders>{borders}</w:tblBorders><w:tblCellMar><w:top w:w="65" w:type="dxa"/><w:bottom w:w="65" w:type="dxa"/><w:left w:w="65" w:type="dxa"/><w:right w:w="65" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>'+''.join(f'<w:gridCol w:w="{w}"/>' for w in widths)+'</w:tblGrid>'
        for i,record in enumerate([headers]+records):
            out+='<w:tr><w:trPr><w:cantSplit/>'+('<w:tblHeader/>' if i==0 else '')+'</w:trPr>'
            if isinstance(record,dict):
                out+=f'<w:tc><w:tcPr><w:tcW w:w="{sum(widths)}" w:type="dxa"/><w:gridSpan w:val="{len(widths)}"/><w:shd w:fill="E7EBEF"/></w:tcPr>'
                out+=paragraph(record['date'],bold=True,size=20,before=70,after=70,keep=True)+'</w:tc></w:tr>'
                continue
            for j,(value,width) in enumerate(zip(record,widths)):
                out+=f'<w:tc><w:tcPr><w:tcW w:w="{width}" w:type="dxa"/><w:vAlign w:val="center"/>'+('<w:shd w:fill="E7EBEF"/>' if i==0 else '')+'</w:tcPr>'+paragraph(value,bold=i in (0,len(records)),align='left' if j==0 else 'right',after=20,before=20)+'</w:tc>'
            out+='</w:tr>'
        return out+'</w:tbl>'
    period=document_names.period(data)
    body=paragraph(document_names.title(data),bold=True,size=28,align='center',after=100,keep=True)
    if period:body+=paragraph('Период: '+period,after=140,keep=True)
    records=[]
    previous_day=None
    for x in sorted(contractor.work_rows(data), key=lambda x: (x.get('load_date') or '',x['id'],bool(x.get('is_contractor')))):
        day=x.get('load_date') or ''
        if day!=previous_day:
            records.append({'date':date.fromisoformat(day).strftime('%d.%m.%Y') if day else 'Дата не указана'})
            previous_day=day
        kind='Вагон' if x['transport']=='wagon' else (('КамАЗ' if x.get('vehicle_kind')=='kamaz' else 'Фура')+(' до 20 т' if Decimal(x['tonnes'])<=20 else ' свыше 20 т'))
        work=f'{contractor.NAME if x.get("is_contractor") else kind} · {x["product_name"]}'
        ref=(x.get('reference') if x['transport']=='wagon' else x.get('buyer')) or ''
        records.append([work,number(x['tonnes']),number(x['rate_snapshot'])+(' ₸/вагон' if x['transport']=='wagon' else ' ₸/т'),cash(x['total_cents']),ref])
    records.append(['Итого','','',cash(data['stats']['total_cents']),''])
    body+=table(['Наименование работ','Тоннаж, т','Тариф','Сумма, ₸','Примечание'],[3572,936,1219,1417,2721],records)
    body+=paragraph('Ведомость на получение оплаты',bold=True,before=180,after=80,keep=True)
    body+=table(['Фамилия и имя','Сумма, ₸','Подпись'],[5329,1984,2552],[[x['name'],cash(x['amount_cents']),''] for x in data['by_loader']]+[['Итого',cash(data['stats']['total_cents']),'']])
    section='<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="737" w:right="737" w:bottom="737" w:left="737" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr>'
    document='<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>'+body+section+'</w:body></w:document>'
    types='<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
    rels='<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'
    out=io.BytesIO()
    with ZipFile(out,'w',ZIP_DEFLATED) as z:
        z.writestr('[Content_Types].xml',types)
        z.writestr('_rels/.rels',rels)
        z.writestr('word/document.xml',document)
    return out.getvalue()
