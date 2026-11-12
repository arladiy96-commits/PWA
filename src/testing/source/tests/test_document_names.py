from document_names import metadata,disposition,backup_filename,title
from urllib.parse import unquote
from io import BytesIO
from zipfile import ZipFile
from word_report import build_docx


def test_document_labels_and_unicode_download():
    d={'from':'2026-11-01','to':'2026-11-05','loads':[{'load_date':'2026-11-02'}]}
    assert metadata(d)==('Наряд_01.11.2026–05.11.2026.docx','Наряд на сдельную оплату за период\nПериод: 01.11.2026 — 05.11.2026')
    assert metadata({**d,'token':'draft'})[0]=='Наряд_к_сдаче_02.11.2026.docx'
    assert metadata({**d,'id':2,'token':'saved'})==('Наряд_№2_02.11.2026.docx','Наряд на сдельную оплату № 2\nПериод: 02.11.2026')
    name,caption=metadata(d,summary=True)
    assert name=='Ведомость_01.11.2026–05.11.2026.docx'
    assert caption.startswith('Ведомость погрузочных работ\n')
    assert unquote(disposition(name).split("''")[1])==name
    disposition(name).encode('latin-1')
    assert backup_filename('2026-11-05')=='Резервная_копия_ГрузКонтроль_05.11.2026.sqlite3'
    empty={**d,'loads':[],'token':'empty','from':'0001-01-01','to':'9999-12-31'}
    assert metadata(empty)==('Наряд_к_сдаче.docx','Наряд на сдельную оплату · к сдаче')


def test_word_title_matches_telegram():
    d={'from':'2026-11-01','to':'2026-11-05','loads':[],'details':[],'by_loader':[],'stats':{'total_cents':0}}
    for extra in ({},{'id':2},{'token':'draft'}):
        data={**d,**extra}
        with ZipFile(BytesIO(build_docx(data))) as z:
            xml=z.read('word/document.xml').decode()
            assert title(data) in xml
            assert 'Вагоны' not in xml
