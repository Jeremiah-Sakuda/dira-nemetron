import {it,expect} from 'vitest';
import {Pool} from 'pg';
import {PostgresAccountStore} from '../../services/orchestrator/src/postgres-store.js';
const url=process.env.DIRA_TEST_DATABASE_URL;
(url?it:it.skip)('records migration hashes once; a second startup does not replay policy DDL',async()=>{
 const first=new PostgresAccountStore(new Pool({connectionString:url,max:2}));
 const second=new PostgresAccountStore(new Pool({connectionString:url,max:2}));
 try{
  await first.initialize();
  const before=await first.pool.query('SELECT name,sha256,applied_at FROM dira_schema_migrations ORDER BY name');
  expect(before.rows).toHaveLength(18);
  const query=second.pool.query.bind(second.pool);
  // The observable database record timestamps must survive actual reinitialization.
  await second.initialize();
  const after=await query('SELECT name,sha256,applied_at FROM dira_schema_migrations ORDER BY name');
  expect(after.rows).toEqual(before.rows);
 }finally{await first.close();await second.close();}
});
