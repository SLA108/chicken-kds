import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';

const token = 'staff-integration-test-token-0123456789abcdef';
const stores = [{id:'store-1',code:'S1',name:'Słowackiego',active:1}];
function environment(overrides={}) {
  return {
    AUTH_SECRET:'test-auth-secret',
    ADMIN_PIN:'123456',
    STAFF_INTEGRATION_TOKEN:token,
    DB:{
      prepare(sql) {
        assert.match(sql,/FROM stores s/);
        return {
          bind(...args) {
            return {async all(){return {results:stores.filter(s=>!args.length||s.id===args[0])}}};
          }
        };
      }
    },
    ...overrides
  };
}
function request(path, bearer=token, method='GET') {
  return new Request('https://kimchipos.app'+path,{
    method,
    headers:bearer===null?{}:{authorization:'Bearer '+bearer}
  });
}

test('Staff store directory returns restaurants with integration credentials',async()=>{
  const response=await worker.fetch(request('/api/integrations/stores'),environment());
  assert.equal(response.status,200);
  assert.deepEqual(await response.json(),{restaurants:stores});
});

test('Staff store directory accepts store_id filter',async()=>{
  const response=await worker.fetch(request('/api/integrations/stores?store_id=store-1'),environment());
  assert.equal(response.status,200);
  assert.deepEqual((await response.json()).restaurants,stores);
});

test('Staff integration denies invalid or missing credentials',async()=>{
  for(const bearer of ['incorrect-token',null]){
    const response=await worker.fetch(request('/api/integrations/stores',bearer),environment());
    assert.equal(response.status,401);
    assert.deepEqual(await response.json(),{error:'Unauthorized'});
  }
});

test('Staff integration reports missing configuration',async()=>{
  const response=await worker.fetch(request('/api/integrations/stores'),environment({STAFF_INTEGRATION_TOKEN:undefined}));
  assert.equal(response.status,503);
});

test('Staff integration is read only',async()=>{
  const response=await worker.fetch(request('/api/integrations/stores',token,'POST'),environment());
  assert.equal(response.status,405);
});

test('Staff revenue and tips routes are protected by integration auth',async()=>{
  for(const path of ['/api/integrations/revenue','/api/integrations/tips']){
    const response=await worker.fetch(request(path,'wrong'),environment());
    assert.equal(response.status,401);
  }
});
