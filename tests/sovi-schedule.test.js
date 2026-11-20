import test from 'node:test';
import assert from 'node:assert/strict';
import {SOVI_COMPETITION,SOVI_ROTATING,sharedSoviPlans} from '../src/sovi-schedule.js';

test('shared planning accepts legacy saved CSVs and excludes partial rows, Competition, and other months',()=>{
 const month='2026-11';
 const rows=[...SOVI_ROTATING.map(study=>({study,folio:'1'})),{study:SOVI_ROTATING[0],folio:'2'},{study:SOVI_COMPETITION,folio:'3'}];
 const result={files:[{rows}]};
 const workspace={month,weeklyPlans:[{month,week:3,result},{month:'2026-10',week:4,result}]};
 assert.deepEqual(sharedSoviPlans(workspace,month),[{week:3,rotating:['1']}]);
 assert.deepEqual(sharedSoviPlans(workspace,'2026-10'),[]);
});
