import {test,expect} from '@playwright/test';
test('daily nutrition opens meals and keeps long tables and charts scrollable',async({page})=>{
 const today=new Date(Date.now()+7*3600000).toISOString().slice(0,10);
 await page.route('**/api/auth**',r=>r.fulfill({json:{account:{id:'owner',display_name:'An',role:'member'}}}));
 await page.route('**/api/dashboard**',r=>{
  const url=new URL(r.request().url());
  return r.fulfill({json:url.searchParams.has('day')?{meals:[{id:'meal',created_at:today+'T04:00:00Z',estimate:{items:[{name:'Cơm gà',kcal:500,protein_g:30,carbs_g:60,fat_g:15}],totals:{kcal:500,protein_g:30,carbs_g:60,fat_g:15}}}]}:{bots:[{id:'bot'}],recent:[],stats:{daily:[{day:today,meal_count:1,kcal:500,protein_g:30,carbs_g:60,fat_g:15}],all_time:{},usage:{}}}});
 });
 await page.goto('/dashboard');
 await expect(page.locator('.chart-legend')).toContainText('Protein');
 await expect(page.locator('.chart .data-label')).toContainText(['495']);
 await page.getByText('Xem bảng số liệu theo ngày',{exact:true}).click();
 const wrap=page.locator('.daily-table-wrap');
 expect(await wrap.evaluate(e=>e.scrollHeight>e.clientHeight)).toBe(true);
 await page.getByRole('button',{name:`Xem bữa ăn ngày ${today}`}).click();
 await expect(page.locator('#day-detail')).toContainText('Cơm gà');
 await expect(page.locator('#day-detail')).toContainText('500');
 await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
