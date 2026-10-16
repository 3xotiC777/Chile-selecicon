// Keep the generated snapshot until its own save is confirmed. A late response
// must never mark a different selection as saved.
export function createSelectionSaver({save,onChange=()=>{}}){
  let draft=null,pending=null,state={phase:'idle',error:'',receipt:null};
  const update=next=>{state=next;onChange(state);};
  return {
    getState:()=>state,
    isSaving:()=>Boolean(pending),
    setDraft(next){draft=next;update({phase:'idle',error:'',receipt:null});},
    save(){
      if(pending)return pending;
      if(!draft)return Promise.resolve(false);
      if(state.phase==='saved')return Promise.resolve(true);
      const submitted=draft;
      update({phase:'saving',error:'',receipt:null});
      pending=Promise.resolve().then(()=>save(submitted)).then(receipt=>{
        if(draft===submitted)update({phase:'saved',error:'',receipt});
        return true;
      },error=>{
        if(draft===submitted)update({phase:'error',error:error.message||'No se pudo confirmar el guardado.',receipt:null});
        return false;
      }).finally(()=>{pending=null;onChange(state);});
      return pending;
    },
  };
}
