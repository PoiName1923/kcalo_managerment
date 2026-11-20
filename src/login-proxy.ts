import type {ApiRequest} from './http.js';
import {authorized} from './security.js';
import {HttpError} from './web-auth.js';

export function requireLoginProxy(req:ApiRequest,secret:string|undefined,
  production=process.env.NODE_ENV==='production'||process.env.VERCEL==='1'){
  if(!secret){
    if(production)throw new HttpError(503,'Cổng giới hạn đăng nhập chưa được cấu hình.');
    return;
  }
  if(!authorized(req.headers['x-calo-login-proxy'],secret))
    throw new HttpError(403,'Yêu cầu đăng nhập phải đi qua cổng Nginx.');
}
