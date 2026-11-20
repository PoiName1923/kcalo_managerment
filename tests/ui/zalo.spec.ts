import {test,expect} from '@playwright/test';
test('choose Zalo, save opaque sender ID and render channel-specific controls',async({page},info)=>{
  let bots:any[]=[];const sender='6ede9afa66b88fe6d6a9';
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.route('**/api/**',async route=>{
    const url=new URL(route.request().url());
    if(url.pathname==='/api/auth')return route.fulfill({json:{account:{id:'owner',display_name:'Minh An',email:'an@example.com',role:'member',active:true}}});
    if(route.request().method()==='POST'){
      const body=route.request().postDataJSON();expect(body.provider).toBe('zalo');expect(body.allowed_user_id).toBe(sender);
      bots=[{id:'00000000-0000-4000-8000-000000000003',name:body.name,provider:'zalo',allowed_user_id:sender,bot_username:'bot.meals',
        gemini_model:body.gemini_model,has_gemini_key:true,has_bot_token:true,enabled:false}];
      return route.fulfill({json:{bot:bots[0]}});
    }
    return route.fulfill({json:{bots}});
  });
  await page.goto('/integrations');
  await page.getByLabel('Kênh nhận ảnh').selectOption('zalo');
  await expect(page.getByLabel('Zalo Bot Token')).toBeVisible();
  await expect(page.getByLabel('Telegram bot token')).toHaveCount(0);
  await page.getByLabel('Tên gợi nhớ').fill('Nhật ký Zalo');
  await page.getByLabel('Zalo User ID').fill(sender);
  await page.getByLabel('Zalo Bot Token').fill('123456789:private-token');
  await page.getByLabel('Gemini API key').fill('private-key');
  await page.getByRole('button',{name:'Lưu cấu hình'}).click();
  await expect(page.getByRole('heading',{name:'Nhật ký Zalo'})).toBeVisible();
  await expect(page.getByRole('button',{name:'Kết nối Zalo Bot'})).toBeVisible();
  await page.getByRole('button',{name:'Chỉnh sửa',exact:true}).click();
  await expect(page.getByLabel('Kênh nhận ảnh')).toBeDisabled();
  await expect(page.getByLabel('Zalo User ID')).toHaveValue(sender);
  await expect(page.getByLabel('Zalo Bot Token')).toHaveValue('');
  await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:`.impeccable/review/zalo-${info.project.name}.png`,fullPage:true});
});
