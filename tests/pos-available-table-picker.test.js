import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const app=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
test('New Order only offers unoccupied tables',()=>{
 assert.match(app,/const availableTables=Array\.from\(\{length:20\}/);
 assert.match(app,/\.filter\(no=>!occupied\.has\(no\)\)/);
 assert.match(app,/availableTables\.map\(no=>'<option/);
 assert.match(app,/No available tables/);
});
test('existing ticket keeps its own table selected for adding items',()=>{
 assert.match(app,/selected\?'<option value="'\+esc\(selected\.table_no\)/);
});
