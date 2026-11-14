import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const app=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const css=readFileSync(new URL('../public/style.css',import.meta.url),'utf8');
test('Stores V3 has clear restaurant, menu and device sections',()=>{
 for(const text of ['Stores & Devices','Restaurants','Store Menu','Approve a device','Registered devices','Revoked devices'])assert.ok(app.includes(text),text);
});
test('existing admin actions and inputs remain wired',()=>{
 for(const id of ['v3-load-stores','v3-store-select','v3-toggle-store','v3-pair-approve'])assert.ok(app.includes(id),id);
 assert.ok(!app.includes('v3-device-form'));
 for(const attr of ['data-v3-select-store','data-v3-save','data-v3-price','data-v3-active','data-v3-sold','data-v3-grants','data-v3-revoke'])assert.ok(app.includes(attr),attr);
});
test('responsive management styles and inactive store messaging exist',()=>{
 assert.match(css,/\.v3-management-section/);
 assert.match(css,/@media\(max-width:700px\)/);
 assert.match(app,/Inactive restaurants cannot be selected/);
});

test('device pairing form and menu editor remain in the rendered admin markup',()=>{
 assert.match(app,/\x27<\/fieldset>\x27\s*\+\s*\x27<div class="v3-form-footer">/);
 assert.match(app,/<form id="v3-pair-approve"/);
 assert.match(app,/<form id="menu-form"/);
 assert.match(app,/\['menu','Menu'\]/);
});
