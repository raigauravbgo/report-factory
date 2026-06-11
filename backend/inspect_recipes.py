import sqlite3, json

conn = sqlite3.connect('dev.db')
cur = conn.cursor()
cur.execute("SELECT name FROM sqlite_master WHERE type='table'")
tables = [r[0] for r in cur.fetchall()]
print('Tables:', tables)

if 'report_recipes' in tables:
    cur.execute('SELECT id, config FROM report_recipes ORDER BY id DESC LIMIT 3')
    for row in cur.fetchall():
        cfg = json.loads(row[1])
        print(f'\nRecipe {row[0]}:')
        print(f'  date_column: {cfg.get("date_column")}')
        print(f'  upload_id: {cfg.get("upload_id")}')
        print(f'  kpis: {json.dumps(cfg.get("kpis"), indent=4)}')
        print(f'  dimensions: {cfg.get("dimensions")}')
        print(f'  column_mappings_count: {len(cfg.get("column_mappings", {}))}')
        first5 = list(cfg.get("column_mappings", {}).keys())[:5]
        print(f'  first 5 column_mappings: {first5}')

conn.close()
