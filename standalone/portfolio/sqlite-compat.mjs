// Node 22.5+ exposes SQLite with --experimental-sqlite. backup() arrived later.
// Keep the same on-disk database and support early Node 22 without npm/native addons.
import * as sqlite from 'node:sqlite';
// Node 22.5 returned an object filled with nulls from get() when there was no
// row; later releases return undefined. Normalize it so auth/existence checks
// have identical semantics across the supported Node 22 line.
export class DatabaseSync extends sqlite.DatabaseSync {
 prepare(sql){
  const statement=super.prepare(sql),all=statement.all.bind(statement);
  statement.get=(...args)=>all(...args)[0];
  return statement;
 }
}
export async function backup(db,target){
 if(typeof sqlite.backup==='function')return sqlite.backup(db,target);
 // SQLite creates a consistent snapshot; never copy a live WAL database as a file.
 db.prepare('VACUUM INTO ?').run(target);
}
