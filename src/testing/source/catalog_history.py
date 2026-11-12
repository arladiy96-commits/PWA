"""Independent buyer catalogs and immutable labels attached to saved loads."""

def buyer_name(value):
    return ' '.join(str(value or '').split())[:150]


def remember_buyer(c, transport, value):
    name = buyer_name(value)
    if not name:
        return
    key = name.casefold()
    if c.execute('SELECT 1 FROM buyer_blocked WHERE transport=? AND name_key=?', (transport,key)).fetchone():
        return
    c.execute('INSERT OR IGNORE INTO buyers(transport,name,name_key) VALUES(?,?,?)', (transport,name,key))


def init(c):
    c.executescript('''
    CREATE TABLE IF NOT EXISTS catalog_migrations (name TEXT PRIMARY KEY);
    CREATE TABLE IF NOT EXISTS buyers (
      id INTEGER PRIMARY KEY AUTOINCREMENT, transport TEXT NOT NULL,
      name TEXT NOT NULL, name_key TEXT NOT NULL, deleted INTEGER NOT NULL DEFAULT 0,
      UNIQUE(transport,name_key));
    CREATE TABLE IF NOT EXISTS buyer_blocked (transport TEXT NOT NULL,name_key TEXT NOT NULL,PRIMARY KEY(transport,name_key));
    CREATE TABLE IF NOT EXISTS load_names (
      load_id INTEGER NOT NULL, loader_id INTEGER NOT NULL, name TEXT NOT NULL,
      PRIMARY KEY(load_id,loader_id));
    ''')
    if 'product_name_snapshot' not in {r[1] for r in c.execute('PRAGMA table_info(loads)')}:
        c.execute('ALTER TABLE loads ADD COLUMN product_name_snapshot TEXT')
    c.execute('UPDATE loads SET product_name_snapshot=(SELECT name FROM products WHERE id=loads.product_id) WHERE product_name_snapshot IS NULL')
    c.execute('''INSERT OR IGNORE INTO load_names SELECT lc.load_id,lc.loader_id,x.name
                 FROM load_crew lc JOIN loaders x ON x.id=lc.loader_id''')
    c.execute('''INSERT OR IGNORE INTO load_names SELECT p.load_id,p.loader_id,x.name
                 FROM statement_lines p JOIN loaders x ON x.id=p.loader_id''')
    if not c.execute("SELECT 1 FROM catalog_migrations WHERE name='buyers_v1'").fetchone():
        for row in c.execute("SELECT transport,buyer FROM loads WHERE deleted=0 ORDER BY id DESC").fetchall():
            remember_buyer(c,row[0],row[1])
        c.execute("INSERT INTO catalog_migrations VALUES('buyers_v1')")
    # Individual load edits may change product, catalog renames may not.
    c.executescript('''
    CREATE TRIGGER IF NOT EXISTS load_product_name_insert AFTER INSERT ON loads BEGIN
      UPDATE loads SET product_name_snapshot=(SELECT name FROM products WHERE id=NEW.product_id) WHERE id=NEW.id;
    END;
    CREATE TRIGGER IF NOT EXISTS load_product_name_change AFTER UPDATE OF product_id ON loads
    WHEN OLD.product_id != NEW.product_id BEGIN
      UPDATE loads SET product_name_snapshot=(SELECT name FROM products WHERE id=NEW.product_id) WHERE id=NEW.id;
    END;
    CREATE TRIGGER IF NOT EXISTS load_loader_name_insert AFTER INSERT ON load_crew BEGIN
      INSERT OR IGNORE INTO load_names(load_id,loader_id,name) SELECT NEW.load_id,NEW.loader_id,name FROM loaders WHERE id=NEW.loader_id;
    END;
    CREATE TRIGGER IF NOT EXISTS load_names_cleanup AFTER DELETE ON loads BEGIN
      DELETE FROM load_names WHERE load_id=OLD.id;
    END;
    ''')
