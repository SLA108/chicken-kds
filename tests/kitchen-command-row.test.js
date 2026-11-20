import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const ui=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const css=readFileSync(new URL('../public/style.css',import.meta.url),'utf8');
test('kitchen view selector stays left and frequent actions stay right',()=>{
 assert.match(ui,/shell\('<div class="kds-command-row">'\+kitchenViewTabs\(\)\+'<div class="kds-command-actions">/);
 assert.match(ui,/id="kds-quick-order">\+ Platform Order/);
 assert.match(ui,/id="sound" class="kds-icon-action"/);
 assert.match(ui,/id="sync" aria-label="Refresh orders"|id="sync"[^>]*aria-label="Refresh orders"/);
 assert.match(ui,/class="kds-more"/);
 assert.match(ui,/id="kds-courier-queue"/);
 assert.doesNotMatch(ui,/Tap anywhere on a dish to toggle Done\.<\/span>/);
});
test('kitchen command row wraps on narrow iPads and preserves touch targets',()=>{
 assert.match(css,/\.kitchen \.kds-command-row\{display:flex/);
 assert.match(css,/\.kitchen \.kds-command-actions\{display:flex/);
 assert.match(css,/min-width:44px;min-height:44px/);
 assert.match(css,/@media\(max-width:760px\)/);
 assert.match(css,/\.kitchen \.kds-view-tabs\{flex:1 1 100%\}/);
});

test('kitchen header is minimal and keeps store switching and navigation accessible',()=>{
 assert.match(ui,/page==='kitchen'\?\x60<header class="kds-minimal-header"/);
 assert.match(ui,/id="kds-store-name"/);
 assert.match(ui,/class="kds-header-menu"/);
 assert.match(ui,/id="kds-switch-slot"/);
 assert.match(ui,/slot\.append\(button\)/);
 assert.match(ui,/href="\/pos">Front of House/);
 assert.match(ui,/href="\/admin">Back Office/);
 assert.match(ui,/id="logout">Log out/);
 assert.match(css,/\.kitchen #app>header\.kds-minimal-header/);
});
