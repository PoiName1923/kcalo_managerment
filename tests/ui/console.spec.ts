import { test,expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

const account={id:'00000000-0000-4000-8000-000000000001',email:'an@example.com',display_name:'Minh An',role:'admin',active:true};
const bot={id:'00000000-0000-4000-8000-000000000003',name:'Nhật ký của An',bot_username:'an_meals_bot',telegram_user_id:123456789,gemini_model:'gemini-3.5-flash-lite',enabled:true,connected_at:'2026-11-20',has_gemini_key:true,has_bot_token:true};
test('login, nutrition filters, bot settings and user administration work responsively',async({page},info)=>{
  await page.emulateMedia({reducedMotion:'reduce'});
  let signedIn=false;let bots=[bot];let saved=false;
  const calls:string[]=[];
  const today=new Date(Date.now()+7*3600000).toISOString().slice(0,10);
  const daily=Array.from({length:7},(_,i)=>({day:new Date(new Date(today).getTime()-(6-i)*86400000).toISOString().slice(0,10),meal_count:3,kcal:[1620,1840,1530,2010,1780,1920,1420][i],protein_g:85,carbs_g:210,fat_g:55}));
  await page.route('**/api/**',async route=>{
    const url=new URL(route.request().url());calls.push(url.pathname+url.search);
    let body:unknown={};
    if(url.pathname==='/api/auth'){
      if(url.searchParams.get('action')==='login'){signedIn=true;body={account};}
      else if(!signedIn)return route.fulfill({status:401,json:{error:'Vui lòng đăng nhập.'}});
      else body={account};
    }else if(url.pathname==='/api/dashboard')body={stats:{daily,all_time:{kcal:64210,meals:92},usage:{calls:24,successes:21,total_tokens:28190}},bots,recent:[{id:'meal',bot_id:bot.id,created_at:new Date().toISOString(),estimate:{items:[{name:'Cơm gà, rau luộc'}],totals:{kcal:540,protein_g:38,carbs_g:65,fat_g:14},confidence:'medium'}}]};
    else if(url.pathname==='/api/integrations'){
      if(route.request().method()==='POST'&&!url.search){const input=route.request().postDataJSON();saved=true;expect(input.gemini_key).toBe('private-gemini-key');bots=[{...bot,name:input.name}];body={bot:bots[0]};}
      else body={bots};
    }else if(url.pathname==='/api/users')body={users:[{...account,bot_count:1},{id:'member',email:'binh@example.com',display_name:'Thanh Bình',role:'member',active:true,bot_count:2}],total:2,page:1};
    await route.fulfill({json:body});
  });
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto('/login');
  await expect(page.getByRole('heading',{name:'Chào mừng trở lại.'})).toBeVisible();
  await mkdir('.impeccable/review',{recursive:true});
  await page.screenshot({path:`.impeccable/review/login-${info.project.name}.png`,fullPage:true});
  await page.getByLabel('Email',{exact:true}).fill('an@example.com');
  await page.getByLabel('Mật khẩu',{exact:true}).fill('a-long-password');
  await page.getByRole('button',{name:'Đăng nhập',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Bức tranh dinh dưỡng của bạn'})).toBeVisible();
  await page.getByLabel('Khoảng thời gian').selectOption('7');
  await expect(page.getByRole('img',{name:'Calo đã ghi nhận theo ngày, 7 ngày gần đây'})).toBeVisible();
  await expect(page.getByText('Cơm gà, rau luộc',{exact:true})).toBeVisible();
  await page.screenshot({path:`.impeccable/review/dashboard-${info.project.name}.png`,fullPage:true});
  await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.getByRole('link',{name:'Bot & API',exact:true}).click();
  await page.getByRole('button',{name:'Chỉnh sửa',exact:true}).click();
  await expect(page.getByLabel('Telegram bot token')).toHaveValue('');
  await page.getByLabel('Tên gợi nhớ').fill('Bot bữa ăn mới');
  await page.getByLabel('Gemini API key').fill('private-gemini-key');
  await page.getByRole('button',{name:'Lưu cấu hình'}).click();
  await expect(page.getByRole('heading',{name:'Bot bữa ăn mới'})).toBeVisible();expect(saved).toBe(true);
  await expect(page.getByText('private-gemini-key',{exact:true})).toHaveCount(0);
  await page.screenshot({path:`.impeccable/review/integrations-${info.project.name}.png`,fullPage:true});
  await page.getByRole('link',{name:'Người dùng',exact:true}).click();
  await expect(page.getByText('binh@example.com')).toBeVisible();
  await page.screenshot({path:`.impeccable/review/users-${info.project.name}.png`,fullPage:true});
  await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.getByRole('link',{name:'Tài khoản',exact:true}).click();
  await page.getByLabel('Mật khẩu mới').fill('new-long-password');
  await page.getByLabel('Nhập lại mật khẩu').fill('different-password');
  await page.getByRole('button',{name:'Đổi mật khẩu',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('Hai mật khẩu chưa trùng nhau.');
  expect(errors).toEqual([]);expect(calls.some(c=>c.includes('days=7'))).toBe(true);
});
test('empty state and API failure have useful recovery actions',async({page})=>{
  await page.route('**/api/auth**',route=>route.fulfill({json:{account:{...account,role:'member'}}}));
  await page.route('**/api/dashboard**',route=>route.fulfill({json:{stats:{daily:[],all_time:{},usage:{}},bots:[],recent:[]}}));
  await page.goto('/dashboard');
  await expect(page.getByRole('heading',{name:'Bắt đầu nhật ký đầu tiên'})).toBeVisible();
  await expect(page.getByRole('link',{name:'Người dùng',exact:true})).toHaveCount(0);
  await page.route('**/api/integrations**',route=>route.fulfill({status:503,json:{error:'Kết nối đang gián đoạn.'}}));
  await page.getByRole('link',{name:'Kết nối bot',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('Kết nối đang gián đoạn.');
  await expect(page.getByRole('button',{name:'Thử lại'})).toBeVisible();
});
