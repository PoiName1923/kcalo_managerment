import {createHmac} from 'node:crypto';
import {isIP} from 'node:net';
import {z} from 'zod';
import type {Database} from './db.js';
import type {ApiRequest} from './http.js';

const resultSchema=z.object({
  allowed:z.boolean(),retry_after:z.number().int().min(0).max(86400),remaining:z.number().int().min(0).max(100),
});

function normalizeIp(value:string|undefined) {
  const input=value?.trim()??'';
  if(!input||input.includes(','))throw new Error('Trusted client IP is unavailable');
  const mapped=input.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i)?.[1];
  const ip=mapped??input;
  if(!isIP(ip))throw new Error('Trusted client IP is unavailable');
  return ip.toLowerCase();
}

export function clientKey(req:ApiRequest,secret:string,isVercel=process.env.VERCEL==='1') {
  if(secret.length<32)throw new Error('Login rate limit is not configured');
  const header=req.headers['x-vercel-forwarded-for'];
  const source=isVercel ? (typeof header==='string'?header:undefined) : req.socket?.remoteAddress;
  return createHmac('sha256',secret).update(normalizeIp(source)).digest('hex');
}

export async function consumeLoginAttempt(db:Database,key:string) {
  const {data,error}=await db.rpc('consume_login_attempt',{p_client_key:key,p_limit:5,p_window_seconds:1800});
  if(error)throw new Error('Login rate limit unavailable');
  const value=resultSchema.parse(data);
  return {allowed:value.allowed,retryAfter:value.retry_after,remaining:value.remaining};
}
