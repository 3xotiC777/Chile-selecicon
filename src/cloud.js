import { createClient } from '@supabase/supabase-js';

const env = import.meta.env || {};
const defaultUrl = env.VITE_SUPABASE_URL || '';
const defaultKey = env.VITE_SUPABASE_PUBLISHABLE_KEY || env.VITE_SUPABASE_ANON_KEY || '';
export const cloudConfigured = Boolean(defaultUrl && defaultKey);

export class CloudError extends Error {
  constructor(message, code = '') { super(message); this.name = 'CloudError'; this.code = code; }
}

function checked(response) {
  if (response.error) {
    const e = response.error;
    throw new CloudError(e.message || 'No se pudo conectar con el seguimiento compartido.', e.code || '');
  }
  return response.data;
}

export function workspaceFromRows(workspace, plans = []) {
  return {
    month: workspace?.active_month || '',
    planning: workspace?.planning || null,
    universe: workspace?.universe || [],
    report: workspace?.report || [],
    metadata: workspace?.metadata || {},
    revision: workspace?.revision || 0,
    updatedAt: workspace?.updated_at || null,
    updatedBy: workspace?.updated_by || null,
    weeklyPlans: plans.map(plan => ({
      month: plan.month, week: plan.week, result: plan.selection,
      metadata: plan.metadata || {}, updatedAt: plan.saved_at, updatedBy: plan.saved_by,
    })).sort((a, b) => b.week - a.week),
  };
}

export function validateSave({ month, planning, universe, report, selection, revision, metadata = {} }) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month || '')) throw new CloudError('Elige un mes válido.');
  if (!Number.isSafeInteger(revision) || revision < 0) throw new CloudError('Recarga el seguimiento antes de guardar.');
  if (planning != null && (!Array.isArray(planning.rows) || !planning.rows.length || !Array.isArray(planning.studies))) {
    throw new CloudError('La planeación está vacía o no tiene el formato esperado.');
  }
  if (universe != null && (!Array.isArray(universe) || !universe.length)) throw new CloudError('Carga un universo válido.');
  if (report != null && !Array.isArray(report)) throw new CloudError('El export no tiene el formato esperado.');
  if ([planning?.rows, universe, report].some(rows => rows?.length > 100000)) throw new CloudError('Los datos exceden el límite de registros del mes.');
  if (selection != null && (!Array.isArray(selection.files) || selection.period?.month !== month || !Number.isInteger(selection.period?.week) || selection.period.week < 1 || selection.period.week > 5)) {
    throw new CloudError('La selección semanal no corresponde al mes activo.');
  }
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) throw new CloudError('Metadatos inválidos.');
  const bytes = value => new TextEncoder().encode(JSON.stringify(value)).length;
  if (bytes(metadata) > 65536) throw new CloudError('Los metadatos exceden el límite permitido.');
  if (bytes({ planning, universe, report }) > 25 * 1024 * 1024) throw new CloudError('Los datos exceden 25 MB. Reduce el export al mes que vas a actualizar.');
  if (selection != null && bytes(selection) > 10 * 1024 * 1024) throw new CloudError('La selección semanal excede 10 MB.');
}

/** Publishable client only: SQL RLS controls access and the server controls user management. */
export function createCloud({ url = defaultUrl, key = defaultKey, client } = {}) {
  if (!client && (!url || !key)) return null;
  const supabase = client || createClient(url, key, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: 'chile-field-session' },
  });
  async function accessAction(body) {
    const { data, error } = await supabase.functions.invoke('chile-access', { body });
    if (error) {
      // Edge HTTP errors can contain a useful safe message rather than SDK's generic status.
      let detail;
      if (error.context?.json) { try { detail = await error.context.json(); } catch { /* use SDK message */ } }
      throw new CloudError(detail?.error || detail?.message || error.message || 'No se pudo gestionar el acceso.');
    }
    if (data?.error) throw new CloudError(data.error);
    return data;
  }
  const cloud = {
    async signIn(email, password) {
      return checked(await supabase.auth.signInWithPassword({ email: email.trim(), password }));
    },
    async signOut() { checked(await supabase.auth.signOut()); },
    async resetPassword(email, redirectTo = globalThis.location?.origin) {
      return checked(await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo }));
    },
    async updatePassword(password) { return checked(await supabase.auth.updateUser({ password })); },
    onAuthChange(callback) {
      const { data } = supabase.auth.onAuthStateChange((event, session) => callback(event, session));
      return () => data.subscription.unsubscribe();
    },
    async getAccess() {
      const { session } = checked(await supabase.auth.getSession());
      if (!session) return { session: null, user: null, role: null, member: null };
      // Verify the token against Auth before presenting a role from the database.
      const { user } = checked(await supabase.auth.getUser());
      const member = checked(await supabase.from('chile_members').select('user_id,role,display_name').eq('user_id', user.id).maybeSingle());
      return { session, user, role: member?.role || null, member };
    },
    async getWorkspaceRevision() {
      const row = checked(await supabase.from('chile_workspace').select('revision').eq('id', true).maybeSingle());
      if (!row) throw new CloudError('Tu acceso al seguimiento fue retirado.', 'ACCESS_DENIED');
      return row.revision;
    },
    async loadWorkspace() {
      // The two REST reads may straddle a monthly replacement or weekly save.
      // Check the revision so the dashboard never combines two different commits.
      for (let attempt = 0; attempt < 3; attempt++) {
        const workspace = checked(await supabase.from('chile_workspace').select('*').eq('id', true).maybeSingle());
        if (!workspace) throw new CloudError('Tu usuario no tiene acceso al seguimiento de Chile. Solicita acceso al administrador.', 'ACCESS_DENIED');
        const plans = workspace.active_month
          ? checked(await supabase.from('chile_weekly_plans').select('*').eq('month', workspace.active_month).order('week', { ascending: false }))
          : [];
        const head = checked(await supabase.from('chile_workspace').select('revision').eq('id', true).maybeSingle());
        if (!head) throw new CloudError('Tu acceso al seguimiento fue retirado.', 'ACCESS_DENIED');
        if (head.revision === workspace.revision) return workspaceFromRows(workspace, plans);
      }
      throw new CloudError('El seguimiento se está actualizando. Vuelve a cargarlo en unos segundos.');
    },
    async saveWorkspace(input) {
      validateSave(input);
      checked(await supabase.rpc('chile_save_workspace', {
        p_month: input.month, p_expected_revision: input.revision,
        p_planning: input.planning ?? null, p_universe: input.universe ?? null,
        p_report: input.report ?? null, p_selection: input.selection ?? null,
        p_metadata: input.metadata || {},
      }));
      return cloud.loadWorkspace();
    },
    async listUsers() { return accessAction({ action: 'list' }); },
    async createUser({ email, password, displayName = '', role = 'field' }) {
      if (!['admin', 'field'].includes(role)) throw new CloudError('Rol de usuario inválido.');
      return accessAction({ action: 'create', email: email.trim(), password, name: displayName.trim(), role });
    },
    async deleteUser(userId) { return accessAction({ action: 'delete', userId }); },
    async firstAdminSetup(token, email, password, displayName = '') {
      return accessAction({ action: 'setup', token, email: email.trim(), password, name: displayName.trim() });
    },
  };
  return cloud;
}
