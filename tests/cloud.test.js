import test from 'node:test';
import assert from 'node:assert/strict';
import { createCloud, validateSave, workspaceFromRows, CloudError } from '../src/cloud.js';

const planning = { rows: [{ folio: '1' }], studies: [{ name: 'POY' }] };
const selection = { period: { month: '2026-10', week: 1 }, files: [{ name: 'POY.csv', rows: [] }] };
function fakeClient({ member = { user_id: 'u1', role: 'field', display_name: 'Campo' }, rpcError = null } = {}) {
  const calls = [];
  const workspace = { active_month: '2026-10', planning, universe: [{ folio: '1' }], report: [], metadata: {}, revision: 3 };
  const client = {
    auth: {
      getSession: async () => ({ data: { session: { access_token: 'session-token' } }, error: null }),
      getUser: async () => ({ data: { user: { id: 'u1', user_metadata: { role: 'admin' } } }, error: null }),
      signInWithPassword: async input => { calls.push(['signIn', input]); return { data: { session: {} }, error: null }; },
      signOut: async () => ({ error: null }),
      onAuthStateChange: callback => ({ data: { subscription: { unsubscribe() { calls.push(['unsubscribe']); } } } }),
    },
    from(table) {
      calls.push(['table', table]);
      return {
        select() { return this; }, eq() { return this; },
        async maybeSingle() { return { data: table === 'chile_members' ? member : workspace, error: null }; },
        async order() { return { data: [{ month: '2026-10', week: 1, selection, saved_at: '2026-10-01T12:00:00Z' }], error: null }; },
      };
    },
    async rpc(name, input) { calls.push(['rpc', name, input]); return { data: { revision: 3 }, error: rpcError }; },
    functions: { async invoke(name, input) { calls.push(['function', name, input.body]); return { data: { ok: true }, error: null }; } },
  };
  return { client, calls };
}

test('cloud access role comes from controlled membership, never editable user metadata', async () => {
  const { client } = fakeClient();
  const access = await createCloud({ client }).getAccess();
  assert.equal(access.role, 'field');
  assert.equal(access.user.user_metadata.role, 'admin');
});

test('signed-in users without membership receive no app role', async () => {
  const { client } = fakeClient({ member: null });
  assert.equal((await createCloud({ client }).getAccess()).role, null);
});

test('background checks request only the revision and report access withdrawal', async () => {
  const fields=[];let row={revision:5};
  const client={from(table){assert.equal(table,'chile_workspace');return{select(value){fields.push(value);return this;},eq(){return this;},async maybeSingle(){return{data:row,error:null};}};}};
  const cloud=createCloud({client});assert.equal(await cloud.getWorkspaceRevision(),5);
  row=null;await assert.rejects(()=>cloud.getWorkspaceRevision(),error=>error.code==='ACCESS_DENIED');
  assert.deepEqual(fields,['revision','revision']);
});

test('export-only cloud updates do not submit replacements for planning, universe or saved selection', async () => {
  const { client, calls } = fakeClient();
  const report = [{ folio: '1', status: 'TERMINADO' }];
  const result = await createCloud({ client }).saveWorkspace({ month: '2026-10', revision: 2, report });
  const rpc = calls.find(call => call[0] === 'rpc');
  assert.deepEqual(rpc.slice(1), ['chile_save_workspace', {
    p_month: '2026-10', p_expected_revision: 2, p_planning: null, p_universe: null,
    p_report: report, p_selection: null, p_metadata: {},
  }]);
  assert.equal(result.planning, planning);
  assert.equal(result.weeklyPlans.length, 1);
  assert.equal(result.weeklyPlans[0].result, selection);
});

test('concurrent save conflicts preserve the database message and do not pretend to save', async () => {
  const { client, calls } = fakeClient({ rpcError: { code: 'PT409', message: 'Otra persona actualizó el seguimiento.' } });
  await assert.rejects(() => createCloud({ client }).saveWorkspace({ month: '2026-10', report: [], revision: 1 }), error => error instanceof CloudError && error.code === 'PT409');
  assert.equal(calls.filter(call => call[0] === 'table').length, 0);
});

test('invalid month, mismatched selected period and missing revision cannot be persisted', () => {
  for (const invalid of [
    { month: '2026-13', revision: 0 },
    { month: '2026-10' },
    { month: '2026-10', revision: 0, planning: { rows: [], studies: [] } },
    { month: '2026-10', revision: 0, selection: { ...selection, period: { month: '2026-09', week: 1 } } },
    { month: '2026-10', revision: 0, report: Array(100001).fill({}) },
  ]) assert.throws(() => validateSave(invalid), CloudError);
});

test('administrator actions use the verified Edge endpoint and reject unexpected roles', async () => {
  const { client, calls } = fakeClient();
  const cloud = createCloud({ client });
  await cloud.createUser({ email: ' field@example.com ', password: 'example-password', displayName: ' Campo ', role: 'field' });
  await cloud.deleteUser('u2');
  await cloud.firstAdminSetup('one-time-token', 'admin@example.com', 'example-password', 'Admin');
  assert.deepEqual(calls.filter(call => call[0] === 'function'), [
    ['function', 'chile-access', { action: 'create', email: 'field@example.com', password: 'example-password', name: 'Campo', role: 'field' }],
    ['function', 'chile-access', { action: 'delete', userId: 'u2' }],
    ['function', 'chile-access', { action: 'setup', token: 'one-time-token', email: 'admin@example.com', password: 'example-password', name: 'Admin' }],
  ]);
  await assert.rejects(() => cloud.createUser({ email: 'x@y.com', password: 'example-password', role: 'owner' }), CloudError);
});

test('persisted weekly ZIP inputs are restored in newest-week order', () => {
  const state = workspaceFromRows({ active_month: '2026-10', revision: 7 }, [
    { month: '2026-10', week: 1, selection: { files: [{ name: 'POY.csv', rows: [{ folio: '1' }] }] } },
    { month: '2026-10', week: 3, selection: { files: [{ name: 'POY.csv', rows: [{ folio: '3' }] }] } },
  ]);
  assert.deepEqual(state.weeklyPlans.map(plan => plan.week), [3, 1]);
  assert.equal(state.weeklyPlans[1].result.files[0].rows[0].folio, '1');
});

test('workspace loads retry a concurrent commit rather than mix planning and weekly selections', async () => {
  let workspaceReads = 0;
  const client = {
    from(table) {
      let columns;
      return {
        select(value) { columns = value; return this; }, eq() { return this; },
        async maybeSingle() {
          if (columns === '*') return { data: { active_month: '2026-10', revision: ++workspaceReads }, error: null };
          return { data: { revision: 2 }, error: null };
        },
        async order() { return { data: [{ month: '2026-10', week: workspaceReads, selection }], error: null }; },
      };
    },
  };
  const state = await createCloud({ client }).loadWorkspace();
  assert.equal(workspaceReads, 2);
  assert.equal(state.revision, 2);
  assert.equal(state.weeklyPlans[0].week, 2);
});
