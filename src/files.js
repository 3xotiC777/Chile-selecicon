// Capture bytes when selected: synced files may change before generation.
export function captureFile(file,label){
  const snapshot={file,bytes:null,task:null};
  snapshot.task=(async()=>{
    try{
      snapshot.bytes=await file.arrayBuffer();
      return snapshot.bytes;
    }catch(cause){
      const error=new Error(`No se pudo leer ${label}: «${file.name}». Si está en OneDrive o SharePoint, marca «Mantener siempre en este dispositivo» y espera a que termine de descargar. También puedes guardar una copia en Descargas. Luego vuelve a seleccionar el archivo.`,{cause});
      error.name='FileReadError';
      throw error;
    }
  })();
  return snapshot;
}
