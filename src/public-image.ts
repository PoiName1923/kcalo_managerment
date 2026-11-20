import { lookup } from 'node:dns/promises';
import { request } from 'node:https';
import { MAX_IMAGE_BYTES } from './images.js';

type Resolve = (hostname:string)=>Promise<{address:string;family:number}[]>;
const publicIPv4=(address:string)=>{
  const p=address.split('.').map(Number);
  if(p.length!==4||p.some(v=>!Number.isInteger(v)||v<0||v>255))return false;
  const [a,b,c]=p;
  return !(a===0||a===10||a===127||a>=224||a===169&&b===254||a===172&&b>=16&&b<=31||
    a===192&&b===168||a===100&&b>=64&&b<=127||a===198&&(b===18||b===19)||
    a===192&&b===0||a===198&&b===51&&c===100||a===203&&b===0&&c===113);
};
export async function downloadPublicImage(source:string,resolve:Resolve=host=>lookup(host,{family:4,all:true})):Promise<Buffer>{
  const deadline=Date.now()+20000;
  async function download(input:string,hops:number):Promise<Buffer>{
    const url=new URL(input);
    if(url.protocol!=='https:'||url.username||url.password||(url.port&&url.port!=='443'))throw new Error('Only public HTTPS image URLs are supported');
    const addresses=await Promise.race([resolve(url.hostname),new Promise<never>((_,reject)=>{
      const timer=setTimeout(()=>reject(new Error('Image DNS timeout')),Math.max(1,deadline-Date.now()));timer.unref();
    })]);
    if(!addresses.length||addresses.some(a=>a.family!==4||!publicIPv4(a.address)))throw new Error('Image must resolve to a public address');
    if(Date.now()>=deadline)throw new Error('Image download timeout');
    // Pin the validated address to the actual TLS connection to prevent DNS rebinding.
    const response=await new Promise<import('node:http').IncomingMessage>((resolveResponse,reject)=>{
      const req=request(url,{method:'GET',family:4,lookup:(_host,_options,done)=>done(null,addresses[0].address,4),
        signal:AbortSignal.timeout(Math.max(1,deadline-Date.now())),headers:{Accept:'image/*'}},resolveResponse);
      req.on('error',()=>reject(new Error('Image network failure')));req.end();
    });
    if([301,302,303,307,308].includes(response.statusCode??0)){
      response.destroy();if(hops>=3||!response.headers.location)throw new Error('Too many image redirects');
      return download(new URL(response.headers.location,url).href,hops+1);
    }
    if(response.statusCode!==200){response.destroy();throw new Error('Image HTTP download failed');}
    const length=Number(response.headers['content-length']);
    if(length>MAX_IMAGE_BYTES){response.destroy();throw new Error('Image too large');}
    const chunks:Buffer[]=[];let size=0;
    try{
      for await(const chunk of response){size+=chunk.length;if(size>MAX_IMAGE_BYTES){response.destroy();throw new Error('Image too large');}chunks.push(Buffer.from(chunk));}
    }catch{throw new Error('Image download failed or too large');}
    return Buffer.concat(chunks);
  }
  return download(source,0);
}
