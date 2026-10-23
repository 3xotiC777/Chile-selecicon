import test from 'node:test';
import assert from 'node:assert/strict';
import {gzipSync} from 'node:zlib';
import {makePlanningSaveHandler} from '../server/planning-save.js';

const input={month:'2026-10',revision:30,selection:{period:{month:'2026-10',week:5},files:[{name:'POY.csv',rows:[{folio:'1'}]}]},metadata:{saveRequestId:'request-1'}};
function fixture({role='admin',authError=null,rpcError=null,receipt={month:'2026-10',revision:31}}={}){
  const calls=[];
  const client={auth:{async getUser(token){calls.push(['auth',token]);return{data:{user:authError?null:{id:'admin-1'}},error:authError};}},
    from(table){assert.equal(table,'chile_members');return{select(){return this;},eq(key,id){assert.equal(key,'user_id');assert.equal(id,'admin-1');return this;},async maybeSingle(){return{data:role?{role}:null};}};},
    async rpc(name,body){calls.push(['rpc',name,body]);return{data:receipt,error:rpcError};}};
  const handler=makePlanningSaveHandler({clientFactory:token=>{calls.push(['client',token]);return client;}});
  const req={method:'POST',headers:{host:'chile-seleccion.vercel.app',origin:'https://chile-seleccion.vercel.app',authorization:'Bearer user-jwt','content-type':'application/octet-stream','x-chile-payload':'gzip'},body:gzipSync(JSON.stringify(input))};
  const res={headers:{},setHeader(k,v){this.headers[k]=v;},end(body){this.data=JSON.parse(body);}};
  return{handler,req,res,calls};
}
test('compressed planning is committed through the authenticated atomic RPC and returns its receipt',async()=>{
  const{handler,req,res,calls}=fixture();await handler(req,res);
  assert.equal(res.statusCode,200);assert.deepEqual(res.data,{month:'2026-10',revision:31});
  assert.equal(res.headers['Cache-Control'],'no-store');
  const rpc=calls.find(c=>c[0]==='rpc');assert.equal(rpc[1],'chile_save_workspace');
  assert.equal(rpc[2].p_expected_revision,30);assert.equal(rpc[2].p_report,null);
  assert.deepEqual(rpc[2].p_selection,input.selection);assert.equal(rpc[2].p_metadata.saveRequestId,'request-1');
});
test('anonymous, expired, field and removed users cannot save or parse uploaded data',async()=>{
  for(const options of [{anonymous:true},{authError:{message:'expired'}},{role:'field'},{role:null}]){
    const{handler,req,res,calls}=fixture(options);req.body=Buffer.from('invalid gzip');
    if(options.anonymous)delete req.headers.authorization;
    await handler(req,res);assert.equal(res.statusCode,options.anonymous||options.authError?401:403);
    assert.equal(calls.some(c=>c[0]==='rpc'),false);
  }
});
test('cross-site writes and unsupported methods are rejected before creating a client',async()=>{
  for(const change of [req=>req.method='GET',req=>req.headers.origin='https://other.example',req=>req.headers['sec-fetch-site']='cross-site']){
    const{handler,req,res,calls}=fixture();change(req);await handler(req,res);
    assert.ok([403,405].includes(res.statusCode));assert.equal(calls.length,0);
  }
});
test('conflicts, revoked permissions, timeouts and invalid receipts cannot be reported as saved',async()=>{
  for(const[options,status,code]of [[{rpcError:{code:'PT409'}},409,'PT409'],[{rpcError:{code:'42501'}},403,'42501'],[{rpcError:{code:'57014',message:'internal query'}},503,'57014'],[{receipt:{}},503,'SAVE_FAILED']]){
    const{handler,req,res}=fixture(options);await handler(req,res);
    assert.equal(res.statusCode,status);assert.equal(res.data.code,code);assert.ok(!JSON.stringify(res.data).includes('internal query'));
  }
});
test('malformed compressed input, oversized uploads, decompression bombs and invalid month are rejected without RPC',async()=>{
  const invalid=[Buffer.from('not gzip'),Buffer.alloc(4*1024*1024+1),gzipSync(Buffer.alloc(36*1024*1024+1)),gzipSync(JSON.stringify({...input,month:'2026-99'}))];
  for(const body of invalid){const{handler,req,res,calls}=fixture();req.body=body;await handler(req,res);assert.ok([400,413].includes(res.statusCode));assert.equal(calls.some(c=>c[0]==='rpc'),false);}
});
test('streamed uploads are accepted with the same bounds as a parsed request body',async()=>{
  const{handler,req,res}=fixture();const body=req.body;delete req.body;
  req[Symbol.asyncIterator]=async function*(){yield body.subarray(0,10);yield body.subarray(10);};
  await handler(req,res);assert.equal(res.statusCode,200);
});
