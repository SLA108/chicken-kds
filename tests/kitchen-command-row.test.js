import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const ui=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
test('kitchen view selector and action buttons share a responsive command row',()=>{
 assert.match(ui,/shell\('<div class="kds-command-row">'\+kitchenViewTabs\(\)\+'<div class="panel toolbar kds-command-actions"><button/);
 assert.match(ui,/Tap anywhere on a dish to toggle Done\.<\/span><\/div><\/div>/);
 assert.match(ui,/\.kds-command-row\{display:flex/);
 assert.match(ui,/@media\(max-width:1050px\)/);
 assert.match(ui,/@media\(max-width:760px\)\{\.kds-command-row\{flex-wrap:wrap/);
});
