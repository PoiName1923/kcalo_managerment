import {test,expect} from '@playwright/test';
test('switching accounts clears the previous owners bot filter',async({page})=>{
  const first={id:'first',email:'first@example.com',display_name:'Người thứ nhất',role:'member',active:true};
  const second={id:'second',email:'second@example.com',display_name:'Người thứ hai',role:'member',active:true};
  const bot={id:'00000000-0000-4000-8000-000000000003',name:'Bot riêng A'};
  let current:typeof first|null=first;
  await page.route('**/api/**',async route=>{
    const url=new URL(route.request().url());
    if(url.pathname==='/api/auth'){
      if(url.searchParams.get('action')==='logout'){current=null;return route.fulfill({json:{ok:true}});}
      if(url.searchParams.get('action')==='login')current=second;
      return route.fulfill({status:current?200:401,json:current?{account:current}:{error:'Đăng nhập lại.'}});
    }
    if(current?.id==='second'&&url.searchParams.get('bot'))return route.fulfill({status:404,json:{error:'Không tìm thấy bot.'}});
    return route.fulfill({json:{stats:{daily:[],all_time:{},usage:{}},bots:current?.id==='first'?[bot]:[],recent:[]}});
  });
  await page.goto('/dashboard');
  await page.getByLabel('Lọc theo bot').selectOption(bot.id);
  await expect(page.getByLabel('Lọc theo bot')).toHaveValue(bot.id);
  await page.getByRole('button',{name:'Đăng xuất',exact:true}).click();
  await page.getByLabel('Email',{exact:true}).fill(second.email);
  await page.getByLabel('Mật khẩu',{exact:true}).fill('another-password');
  await page.getByRole('button',{name:'Đăng nhập',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Bức tranh dinh dưỡng của bạn'})).toBeVisible();
  await expect(page.getByLabel('Lọc theo bot')).toHaveValue('');
});
