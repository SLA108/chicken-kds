import test from 'node:test';
import assert from 'node:assert/strict';
import {warsawMidnightUtc,warsawDayBounds} from '../src/platform-history-time.js';
test('winter Warsaw midnight uses CET UTC+1',()=>assert.equal(warsawMidnightUtc('2026-11-16'),'2026-11-15T23:00:00.000Z'));
test('summer Warsaw midnight uses CEST UTC+2',()=>assert.equal(warsawMidnightUtc('2026-07-16'),'2026-07-15T22:00:00.000Z'));
test('spring DST transition has 23-hour Polish calendar day',()=>{const {start,end}=warsawDayBounds('2026-03-29','2026-03-29');assert.equal((Date.parse(end)-Date.parse(start))/3600000,23)});
test('autumn DST transition has 25-hour Polish calendar day',()=>{const {start,end}=warsawDayBounds('2026-10-25','2026-10-25');assert.equal((Date.parse(end)-Date.parse(start))/3600000,25)});
test('midnight boundary excludes previous Polish day',()=>{const {start,end}=warsawDayBounds('2026-11-16','2026-11-16');assert.equal(start,'2026-11-15T23:00:00.000Z');assert.equal(end,'2026-11-16T23:00:00.000Z')});
test('invalid ranges and calendar dates rejected',()=>{assert.throws(()=>warsawDayBounds('2026-11-17','2026-11-16'));assert.throws(()=>warsawMidnightUtc('2026-02-30'))});
