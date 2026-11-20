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
 assert.match(ui,/\(page==='kitchen'\|\|page==='pos'\)\?\x60<header class="kds-minimal-header"/);
 assert.match(ui,/id="kds-store-name"/);
 assert.match(ui,/class="kds-header-menu"/);
 assert.match(ui,/id="kds-switch-slot"/);
 assert.match(ui,/slot\.append\(button\)/);
 assert.match(ui,/href="\$\{page===\x27pos\x27\?\x27\/kitchen\x27:\x27\/pos\x27\}">\$\{page===\x27pos\x27\?\x27Kitchen Display\x27:\x27POS\x27\}/);
 assert.match(ui,/href="\/admin">Back Office/);
 assert.match(ui,/id="logout">Log out/);
 assert.match(css,/\.kitchen #app>header\.kds-minimal-header/);
});

test('kitchen store switch menu replaces the previous button on each refresh',()=>{
 assert.match(ui,/const slot=document\.querySelector\('#kds-switch-slot'\);if\(slot\)\{slot\.replaceChildren\(\)/);
 assert.match(ui,/slot\.append\(button\)/);
 assert.match(ui,/banner\.remove\(\)/);
});

test('POS uses compact header without changing Back Office navigation',()=>{
 assert.match(ui,/page==='kitchen'\|\|page==='pos'/);
 assert.match(ui,/page==='pos'\?'POS':'Kitchen'/);
 assert.match(ui,/page==='pos'\?'\/kitchen':'\/pos'/);
 assert.match(ui,/if\(page==='kitchen'\|\|page==='pos'\)\{/);
 assert.match(css,/body:not\(\.kitchen\) #app>header\.kds-minimal-header/);
});

test('POS compact workspace retains pickup actions and ordered scrolling categories',()=>{
 assert.match(ui,/class="foh-compact-nav"/);
 assert.match(ui,/id="pickup-sound" class="foh-icon-action"/);
 assert.match(ui,/id="pickup-nav" class="foh-icon-action"/);
 assert.match(ui,/class="chips foh-category-strip"/);
 assert.match(ui,/kitchenCategories\.map\(c=>\[String\(c\.name\)/);
 assert.match(ui,/page==='kitchen'\|\|page==='pos'/);
 assert.match(ui,/class="ck-compact-logo"/);
 assert.match(css,/\.foh-category-strip\{flex-wrap:nowrap;overflow-x:auto/);
 assert.match(css,/\.ck-compact-logo\{width:36px;height:36px/);
});
