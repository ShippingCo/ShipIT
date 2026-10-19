import type {AccountantFile} from '@shippingco/shared';
import {protocol} from './dto';
/** Uncompressed POSIX tar: portable CSV bundle, no dependency or executable content. */
export function csvBundle(files:readonly AccountantFile[]):Blob {
 const encoder=new TextEncoder(),parts:Uint8Array<ArrayBuffer>[]=[];let bytes=1024;
 for(const file of files){
  if(!/^[a-z_]+\.csv$/.test(file.name))return protocol();
  const data=encoder.encode(file.csv),header=new Uint8Array(512),write=(s:string,offset:number)=>header.set(encoder.encode(s),offset);
  write(file.name,0);write('0000600\0',100);write('0000000\0',108);write('0000000\0',116);write(data.length.toString(8).padStart(11,'0')+'\0',124);write('00000000000\0',136);
  header.fill(32,148,156);write('0',156);write('ustar\0',257);write('00',263);
  const checksum=header.reduce((sum,b)=>sum+b,0);write(checksum.toString(8).padStart(6,'0')+'\0 ',148);
  const padding=(512-data.length%512)%512;bytes+=512+data.length+padding;
  if(bytes>8*1024*1024)return protocol();parts.push(header,data,new Uint8Array(padding));
 }
 parts.push(new Uint8Array(1024));return new Blob(parts,{type:'application/x-tar'});
}
