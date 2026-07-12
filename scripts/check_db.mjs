import Database from 'better-sqlite3';

const db = new Database('stardict.db');
console.log('=== 主词典 ===');
const main = db.prepare("SELECT word, translation FROM stardict WHERE word LIKE '%nice to meet you%'").all();
console.log('找到', main.length, '条');
main.forEach(r => console.log(`  "${r.word}" -> ${(r.translation || '').slice(0, 80)}`));

const sub = new Database('stardict_sub.db');
console.log('\n=== 副词典 ===');
const subRows = sub.prepare("SELECT word, translation FROM stardict WHERE word LIKE '%nice to meet you%'").all();
console.log('找到', subRows.length, '条');
subRows.forEach(r => console.log(`  "${r.word}" -> ${(r.translation || '').slice(0, 80)}`));

db.close();
sub.close();
