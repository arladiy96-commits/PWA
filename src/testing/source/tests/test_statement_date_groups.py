from io import BytesIO
from docx import Document
from docx.oxml.ns import qn
from test_contractor import env
from test_app import a
from word_report import build_docx

def test_work_dates_grouped_and_people_unchanged(env):
    cl,req,products,crew,load,submit,rates,admin,lev,other=env
    load(day='2026-11-02')
    load(transport='truck',day='2026-11-03')
    load(day='2026-11-02')
    data=a.report_data('2026-11-01','2026-11-30')
    data['loads'].reverse()
    doc=Document(BytesIO(build_docx(data)))
    work,people=doc.tables
    headings=[]
    for row in work.rows:
        cell=row._tr.find(qn('w:tc'))
        if cell.find('.//'+qn('w:gridSpan')) is not None:
            headings.append(row.cells[0].text)
            assert cell.find('.//'+qn('w:shd')) is not None
            assert cell.find('.//'+qn('w:b')) is not None
            assert cell.find('.//'+qn('w:keepNext')) is not None
    assert headings==['02.11.2026','03.11.2026']
    assert [r.cells[0].text for r in people.rows[1:-1]]==[x['name'] for x in data['by_loader']]
    cash=lambda n:f'{n/100:,.2f}'.replace(',',' ').replace('.',',')
    assert [r.cells[1].text for r in people.rows[1:-1]]==[cash(x['amount_cents']) for x in data['by_loader']]
    assert work.rows[-1].cells[3].text==cash(data['stats']['total_cents'])
    assert len(work.rows)==len(a.contractor.work_rows(data))+4
