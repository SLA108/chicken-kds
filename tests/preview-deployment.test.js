import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const config=readFileSync(new URL('../wrangler.toml',import.meta.url),'utf8');
const pkg=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8'));
const workflow=readFileSync(new URL('../.github/workflows/deploy-preview.yml',import.meta.url),'utf8');
test('preview Worker is distinct and shares only intended existing data bindings',()=>{
 const preview=config.split('[env.preview]')[1];
 assert.ok(preview);
 assert.match(preview,/name = "chicken-kds-preview"/);
 assert.match(preview,/database_name = "chicken_kds"/);
 assert.match(preview,/database_id = "82bc303c-98c0-4701-9a5d-bbf703a2bb6d"/);
 assert.match(preview,/bucket_name = "chicken-kds-images"/);
 assert.match(preview,/class_name = "OrderRoom"/);
 assert.match(preview,/binding = "ASSETS"/);
});
test('preview deployment is explicit and does not change production deploy command',()=>{
 assert.equal(pkg.scripts.deploy,'wrangler deploy');
 assert.equal(pkg.scripts['deploy:preview'],'wrangler deploy --env preview');
 assert.match(workflow,/workflow_dispatch:/);
 assert.doesNotMatch(workflow,/\n\s*push:/);
 assert.match(workflow,/npm run deploy:preview/);
});
