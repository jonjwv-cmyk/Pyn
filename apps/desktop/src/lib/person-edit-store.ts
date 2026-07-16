import { createZustandStore as create, type Person } from '@pyn/core';
import type { PersonEditTarget } from '@/components/mol/PersonEditDialog';

export interface PersonEditFormState {
  tab: string;
  fio: string;
  position: string;
  status: string;
  mobile: string;
  work: string;
  mail: string;
  comment: string;
  /** «Уволился» — ручная пометка, главнее выгрузки (юзер 2026-07-17). */
  dismissed: boolean;
  broadcastEnabled: boolean;
  broadcastGroup: string;
  broadcastPurpose: string;
  broadcastApprovalWarehouses: string[];
}

export const EMPTY_PERSON_EDIT_FORM: PersonEditFormState = {
  tab: '', fio: '', position: '', status: '', mobile: '', work: '', mail: '', comment: '',
  dismissed: false,
  broadcastEnabled: false, broadcastGroup: '', broadcastPurpose: '', broadcastApprovalWarehouses: [],
};

function formFromPerson(p: Person): PersonEditFormState {
  return {
    tab: p.tab, fio: p.fio, position: p.position, status: p.status,
    mobile: p.mobile, work: p.work, mail: p.mail, comment: p.comment,
    dismissed: p.isDismissed,
    broadcastEnabled: p.broadcastEnabled,
    broadcastGroup: p.broadcastGroup,
    broadcastPurpose: p.broadcastPurpose,
    broadcastApprovalWarehouses: Array.isArray(p.broadcastApprovalWarehouses)
      ? [...p.broadcastApprovalWarehouses]
      : [],
  };
}

function sessionKey(target: PersonEditTarget): string {
  if (target.mode === 'create') return 'create';
  return `${target.mode}:${target.person.id}`;
}

interface PersonEditStore {
  target: PersonEditTarget | null;
  form: PersonEditFormState;
  warehousesPanelOpen: boolean;
  warehousesSearchQuery: string;
  saving: boolean;

  open: (target: PersonEditTarget) => void;
  close: () => void;
  setForm: (patch: Partial<PersonEditFormState>) => void;
  setWarehousesPanelOpen: (open: boolean) => void;
  setWarehousesSearchQuery: (q: string) => void;
  setSaving: (saving: boolean) => void;
}

export const usePersonEditStore = create<PersonEditStore>((set, get) => ({
  target: null,
  form: EMPTY_PERSON_EDIT_FORM,
  warehousesPanelOpen: false,
  warehousesSearchQuery: '',
  saving: false,

  open(target) {
    const prev = get();
    const key = sessionKey(target);
    const prevKey = prev.target ? sessionKey(prev.target) : null;
    const sameSession = key === prevKey && prev.target !== null;
    set({
      target,
      form: sameSession
        ? prev.form
        : (target.mode === 'create' ? EMPTY_PERSON_EDIT_FORM : formFromPerson(target.person)),
      warehousesPanelOpen: sameSession ? prev.warehousesPanelOpen : false,
      warehousesSearchQuery: sameSession ? prev.warehousesSearchQuery : '',
      saving: false,
    });
  },

  close() {
    set({
      target: null,
      form: EMPTY_PERSON_EDIT_FORM,
      warehousesPanelOpen: false,
      warehousesSearchQuery: '',
      saving: false,
    });
  },

  setForm(patch) {
    set((s) => ({ form: { ...s.form, ...patch } }));
  },

  setWarehousesPanelOpen(open) {
    set({ warehousesPanelOpen: open });
  },

  setWarehousesSearchQuery(q) {
    set({ warehousesSearchQuery: q });
  },

  setSaving(saving) {
    set({ saving });
  },
}));