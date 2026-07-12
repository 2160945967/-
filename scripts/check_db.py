import sqlite3

db = sqlite3.connect('stardict.db')
print('=== 主词典 ===')
rows = db.execute("SELECT word, translation FROM stardict WHERE word LIKE '%nice to meet you%'").fetchall()
print(f'找到 {len(rows)} 条')
for r in rows:
    print(f'  "{r[0]}" -> {r[1][:80] if r[1] else ""}')

sub = sqlite3.connect('stardict_sub.db')
print('\n=== 副词典 ===')
rows = sub.execute("SELECT word, translation FROM stardict WHERE word LIKE '%nice to meet you%'").fetchall()
print(f'找到 {len(rows)} 条')
for r in rows:
    print(f'  "{r[0]}" -> {r[1][:80] if r[1] else ""}')

db.close()
sub.close()
