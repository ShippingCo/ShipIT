/** Ephemeral JPEG derivative. Canvas omits common EXIF, but is not a full metadata sanitizer. */
export function downscaleImageBlob(file:Blob,maxWidth=1280,quality=0.8,signal?:AbortSignal):Promise<Blob> {
  return new Promise((resolve,reject)=>{
    const url=URL.createObjectURL(file),img=new Image();let settled=false;
    const finish=(blob?:Blob)=>{if(settled)return;settled=true;URL.revokeObjectURL(url);signal?.removeEventListener('abort',abort);img.onload=null;img.onerror=null;if(blob&&!signal?.aborted)resolve(blob);else reject(new Error('IMAGE_UNAVAILABLE'));};
    const abort=()=>{img.src='';finish();};signal?.addEventListener('abort',abort,{once:true});
    img.onload=()=>{try{
      if(!img.width||!img.height||img.width*img.height>40_000_000){finish();return;}
      const scale=Math.min(1,maxWidth/img.width),canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(img.width*scale));canvas.height=Math.max(1,Math.round(img.height*scale));
      const context=canvas.getContext('2d');if(!context){finish();return;}context.drawImage(img,0,0,canvas.width,canvas.height);canvas.toBlob(blob=>finish(blob??undefined),'image/jpeg',quality);
    }catch{finish();}};
    img.onerror=()=>finish();if(signal?.aborted){abort();return;}img.src=url;
  });
}
