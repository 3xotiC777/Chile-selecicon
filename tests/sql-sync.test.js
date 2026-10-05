import test from 'node:test';
import assert from 'node:assert/strict';
import {sqlConfig,sqlStatus,normalizeSqlReport,REPORT_QUERY,operationalRange} from '../server/sql-report.js';
import {authorizeSync,matchesCron,makeSyncHandler,syncReport} from '../server/sql-sync.js';
import {sharedReportFor} from '../src/report-source.js';
import {durationMinutes,buildTracking} from '../src/tracking.js';
const range={start:'2026-09-28',end:'2026-10-31'},secret='test-secret-'.repeat(4);

test('SQL connection always encrypts and validates certificates, including explicit private CA',()=>{
  const env={SQLSERVER_HOST:'server',SQLSERVER_USER:'reader',SQLSERVER_DATABASE:'db',SQLSERVER_PASSWORD:'password'};
  const c=sqlConfig(env);assert.equal(c.options.encrypt,true);assert.equal(c.options.trustServerCertificate,false);
  const pinned=sqlConfig({...env,SQLSERVER_CA_PEM:'certificate',SQLSERVER_CERT_NAME:'cert-name'});
  assert.equal(pinned.options.cryptoCredentialsDetails.ca,'certificate');assert.equal(pinned.options.serverName,'cert-name');
  assert.throws(()=>sqlConfig({}),/SQL_CONFIG/);
});
test('SQL range uses saved operational dates, including September in October',()=>{
  assert.deepEqual(operationalRange({active_month:'2026-10',metadata:{options:{monthRange:range}}}),range);
  assert.match(REPORT_QUERY,/>= @periodStart AND v\.DIA < @periodEndExclusive/);
  assert.doesNotMatch(REPORT_QUERY,/2026-01-01|NOLOCK/);
  assert.doesNotMatch(REPORT_QUERY,/\b(INSERT|UPDATE|DELETE|EXEC|ALTER|DROP)\b/i);
});
test('SQL numeric states match the exported labels; unknown states never become completed',()=>{
  assert.equal(sqlStatus(4),'TERMINADO');assert.equal(sqlStatus(5),'RECHAZO');
  assert.equal(sqlStatus(1),'VACIO');assert.equal(sqlStatus(2),'VACIO');assert.equal(sqlStatus(3),'ESTADO 3');
  assert.equal(sqlStatus('terminado'),'TERMINADO');
});
test('normalized records retain actual auditor, dates, status and survey duration',()=>{
  const [r]=normalizeSqlReport([{FOLIO:'63402005.0',VISITA:'999',ESTUDIO:'Precios colgate',ESTADO:4,DIA:'2026-09-28',
    COD_AUDITOR:10980,AUDITOR:'Julio',SEGUNDOS:2940,INICIO:'2026-09-28T09:00:00',FIN:'2026-09-28T09:49:00'}],range);
  assert.equal(r.status,'TERMINADO');assert.equal(r.folio,'63402005');assert.equal(r.auditorCode,'10980');
  assert.equal(r.day,'2026-09-28');assert.equal(durationMinutes(r),49);
  assert.throws(()=>normalizeSqlReport([{DIA:'2026-09-27'}],range),/REPORT_INVALID/);
  assert.throws(()=>normalizeSqlReport(Array(100001).fill({}),range),/REPORT_LIMIT/);
});
test('unstarted SQL surveys remain empty at their point without creating productivity or a last visit',()=>{
  const report=normalizeSqlReport([{FOLIO:'1',VISITA:'9',ESTUDIO:'EXHIBICIONES COLGATE',ESTADO:1,DIA:'2026-10-05'}],range);
  const planning={studies:[{name:'EXHIBICIONES COLGATE',id:'1',start:'2026-10-05',end:'2026-10-10'}],rows:[{folio:'1',study:'EXHIBICIONES COLGATE',auditor:'9',auditorName:'Ana',start:'2026-10-05',end:'2026-10-10'}]};
  const tracking=buildTracking({planning,report,options:{month:'2026-10',week:2,weeks:5,start:'2026-10-05',end:'2026-10-10',monthRange:range}});
  assert.equal(tracking.points[0].empty,1);assert.equal(tracking.points[0].validVisits,0);
  assert.equal(tracking.points[0].lastVisit,null);assert.equal(tracking.daily.length,0);
});
test('cron requires the strong server secret and manual sync verifies Auth plus membership',async()=>{
  assert.equal(matchesCron(`Bearer ${secret}`,secret),true);assert.equal(matchesCron('Bearer wrong',secret),false);
  assert.equal(matchesCron('Bearer x','x'),false);
  const client={auth:{getUser:async()=>({data:{user:{id:'field-user',user_metadata:{role:'admin'}}}})},from(){return{select(){return this;},eq(){return this;},maybeSingle:async()=>({data:{role:'field'}})};}};
  await assert.rejects(()=>authorizeSync({method:'POST',headers:{authorization:'Bearer token'}},client),e=>e.status===403);
  await assert.rejects(()=>authorizeSync({method:'POST',headers:{}},client),e=>e.status===401);
  await assert.rejects(()=>authorizeSync({method:'POST',headers:{'sec-fetch-site':'cross-site',authorization:'Bearer token'}},client),e=>e.status===403);
});
test('unauthorized requests never create a server client or query SQL',async()=>{
  const handler=makeSyncHandler({env:{CRON_SECRET:secret},clientFactory(){throw new Error('must not run');}});
  const res={setHeader(){},end(body){this.body=JSON.parse(body);}};
  await handler({method:'GET',headers:{}},res);assert.equal(res.statusCode,401);
  await handler({method:'DELETE',headers:{}},res);assert.equal(res.statusCode,405);
});
test('successful sync reads only leased dates and writes only report via the service RPC',async()=>{
  const calls=[];
  const client={async rpc(name,input){calls.push([name,input]);return {data:name==='chile_begin_sql_sync'?{started:true,month:'2026-10',...range}:{ok:true,syncedAt:'2026-10-05T12:00:00Z'}};}};
  const r=await syncReport(client,null,{readReport:async actual=>{assert.deepEqual(actual,range);return[{day:range.start}];}});
  assert.equal(r.rows,1);assert.equal(calls[1][0],'chile_finish_sql_sync');
  assert.deepEqual(Object.keys(calls[1][1]).sort(),['p_error_code','p_report','p_run_id']);
});
test('overlapping sync never queries SQL and upstream errors are redacted',async()=>{
  const busy={rpc:async()=>({data:{started:false,reason:'busy'}})};
  assert.equal((await syncReport(busy,null,{readReport(){throw new Error('must not run');}})).skipped,'busy');
  const calls=[];const client={async rpc(name,input){calls.push(input);return {data:{started:true,month:'2026-10',...range}};}};
  await assert.rejects(()=>syncReport(client,null,{readReport(){throw new Error('SQL password private information');}}),e=>e.code==='SQL_UNAVAILABLE'&&!e.message.includes('password'));
  assert.equal(calls.at(-1).p_error_code,'SQL_UNAVAILABLE');assert.equal(calls.at(-1).p_report,null);
});
test('shared report is reusable only for matching month and complete date coverage',()=>{
  const w={month:'2026-10',report:[],revision:8,metadata:{reportName:'SQL Server',reportSource:'sqlserver',options:{monthRange:range}}};
  assert.equal(sharedReportFor(w,'2026-10',range).rows,w.report);
  assert.equal(sharedReportFor(w,'2026-11',range),null);
  assert.equal(sharedReportFor(w,'2026-10',{...range,start:'2026-09-27'}),null);
  assert.equal(sharedReportFor({...w,metadata:{}},'2026-10',range),null);
});
