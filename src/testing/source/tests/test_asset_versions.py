from pathlib import Path
from test_app import a


def test_index_versions_follow_file_content(tmp_path,monkeypatch):
    static=tmp_path/'static';static.mkdir()
    (static/'index.html').write_text('<script src="/static/app.js?v=old"></script><link href="/static/style.css?v=old"><script src="https://telegram.org/js/telegram-web-app.js?64"></script>')
    (static/'app.js').write_text('first');(static/'style.css').write_text('body{}')
    monkeypatch.setattr(a,'ROOT',tmp_path)
    first=a.index();assert first.headers['cache-control']=='no-store'
    assert b'?v=old' not in first.body
    assert b'https://telegram.org/js/telegram-web-app.js?64' in first.body
    (static/'app.js').write_text('second')
    second=a.index();assert first.body!=second.body
    assert second.body==a.index().body
