import test from 'node:test';
import assert from 'node:assert/strict';
import {suggestPeriod} from '../src/period.js';
test('September 21 is suggested as fourth operational week; September 14 as third',()=>{assert.deepEqual(suggestPeriod('2026-09-21'),{month:'2026-09',week:4,weeks:5});assert.equal(suggestPeriod('2026-09-14').week,3);});
test('four full weeks are suggested for February 2027',()=>{assert.deepEqual(suggestPeriod('2027-02-22'),{month:'2027-02',week:4,weeks:4});});
