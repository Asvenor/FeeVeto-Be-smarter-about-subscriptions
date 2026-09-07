import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';

// Execute production SQL with real SQLite constraints instead of matching query strings.
export async function testDatabase(){
  const sqlite=new DatabaseSync(':memory:');
  sqlite.exec(await readFile(new URL('../../migrations/0002_saved_audits.sql',import.meta.url),'utf8'));
  const prepare=(sql,bindings=[])=>({
    bind(...values){return prepare(sql,values);},
    async first(){return sqlite.prepare(sql).get(...bindings) || null;},
    async all(){return {results:sqlite.prepare(sql).all(...bindings)};},
    async run(){return sqlite.prepare(sql).run(...bindings);},
  });
  return {prepare,close:()=>sqlite.close()};
}
