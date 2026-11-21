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

test('POS compact workspace retains pickup actions and ordered wrapping categories',()=>{
 assert.match(ui,/class="foh-compact-nav"/);
 assert.match(ui,/id="pickup-sound" class="foh-icon-action"/);
 assert.match(ui,/id="pickup-nav" class="foh-icon-action"/);
 assert.match(ui,/class="chips foh-category-strip"/);
 assert.match(ui,/kitchenCategories\.map\(c=>\[String\(c\.name\)/);
 assert.match(ui,/page==='kitchen'\|\|page==='pos'/);
 assert.match(ui,/class="ck-compact-logo"/);
 assert.match(css,/\.foh-category-strip\{display:flex;flex-wrap:wrap/);
 assert.match(css,/\.ck-compact-logo\{width:36px;height:36px/);
});

test('POS order type and table selection use accessible buttons instead of native selects',()=>{
 assert.match(ui,/class="foh-order-types" role="group"/);
 assert.match(ui,/data-order-type/);
 assert.match(ui,/id="foh-table-trigger"/);
 assert.match(ui,/id="foh-table-grid"/);
 assert.match(ui,/data-select-table/);
 assert.match(ui,/availableTables\.map\(no=>/);
 assert.match(ui,/if\(selected\)return;type=b\.dataset\.orderType/);
 assert.doesNotMatch(ui,/<select id="type"/);
 assert.doesNotMatch(ui,/<select id="table"/);
 assert.match(css,/\.foh-table-grid-items\{display:grid/);
 assert.match(css,/min-height:44px/);
});

test('POS keeps dark slate theme and table picker independent from Tables page grid',()=>{
 assert.match(css,/body:has\(\.foh-compact-nav\)\{background:#17212d;color:#e6edf4\}/);
 assert.match(css,/\.foh-table-popover\{position:absolute/);
 assert.match(css,/\.foh-table-popover\[hidden\]\{display:none\}/);
 assert.match(ui,/id="foh-table-grid" class="foh-table-popover"/);
 assert.match(ui,/\['dinein','Dine-in'\]/);
 assert.match(ui,/\['takeaway','Takeaway'\]/);
 assert.doesNotMatch(ui,/\['delivery','Delivery'\]/);
});

test('POS order types use monochrome utensils and shopping bag icons, not colorful emoji',()=>{
 assert.match(ui,/class="foh-order-type-icon"/);
 assert.match(ui,/stroke="currentColor"/);
 assert.doesNotMatch(ui,/🍽️ Dine-in|🛍️ Takeaway/);
 assert.match(css,/\.foh-order-type-icon\{display:inline-block/);
});

test('POS categories remain visible on multiple rows with no horizontal scrolling',()=>{
 assert.match(css,/\.foh-category-strip\{display:flex;flex-wrap:wrap/);
 assert.match(css,/overflow:visible;padding:2px 0 8px/);
 assert.match(css,/\.foh-category-strip button\{flex:0 0 auto;white-space:normal/);
 assert.doesNotMatch(css,/\.foh-category-strip\{flex-wrap:nowrap;overflow-x:auto/);
 assert.match(ui,/\['All',\.\.\.cats\]/);
});
