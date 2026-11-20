import assert from 'node:assert/strict';
import test from 'node:test';
import { Zalo,acceptZaloUpdate } from '../src/zalo.js';
import { downloadPublicImage } from '../src/public-image.js';

const sender='6ede9afa66b88fe6d6a9';
const event={event_name:'message.image.received',message:{message_id:'2d758cb5e222177a4e36',date:Date.now(),
  from:{id:sender,is_bot:false},chat:{id:sender,chat_type:'PRIVATE'},photo_url:'https://photo.zadn.vn/meal.jpg',caption:'Bữa trưa'}};
test('Zalo image event retains opaque string IDs and normalizes photo_url',()=>{
  const result=acceptZaloUpdate(event,sender);
  assert.equal(result?.update_id,'2d758cb5e222177a4e36');
  assert.equal(result?.chat_id,sender);
  assert.equal(result?.payload.file_id,'https://photo.zadn.vn/meal.jpg');
  assert.equal(result?.payload.caption,'Bữa trưa');
  assert.equal(acceptZaloUpdate(event,'other'),null);
  assert.equal(acceptZaloUpdate({...event,event_name:'message.unsupported.received'},sender),null);
  assert.equal(acceptZaloUpdate({...event,message:{...event.message,chat:{id:sender,chat_type:'GROUP'}}},sender),null);
  assert.equal(acceptZaloUpdate({...event,message:{...event.message,date:100}},sender),null);
  assert.equal(acceptZaloUpdate({...event,message:{...event.message,message_id:undefined}},sender),null);
});
test('Zalo text chunking obeys 2000 UTF-16 units and uses string chat_id without Telegram reply fields',async()=>{
  const bodies:{chat_id:string;text:string}[]=[];
  const bot=new Zalo('123:private',async(url,init)=>{
    assert.equal(String(url),'https://bot-api.zaloplatforms.com/bot123:private/sendMessage');
    const body=JSON.parse(String(init?.body));assert.equal('reply_parameters' in body,false);bodies.push(body);
    return new Response(JSON.stringify({ok:true,result:{message_id:'abc'}}));
  });
  const text='🍚'.repeat(1500)+'bữa ăn';await bot.sendText(sender,text);
  assert.equal(bodies.map(b=>b.text).join(''),text);
  assert.ok(bodies.length>1&&bodies.every(b=>b.text.length<=2000&&b.chat_id===sender));
});
test('Zalo API errors never echo token or upstream response',async()=>{
  const bot=new Zalo('private-token',async()=>new Response('private-token',{status:502}));
  await assert.rejects(bot.call('getMe',{}),e=>e instanceof Error&&!e.message.includes('private-token')&&e.message.includes('502'));
});
test('image download rejects local/non-HTTPS URLs and private DNS before connecting',async()=>{
  for(const url of ['http://photo.zalo.me/a','https://user:pass@photo.zalo.me/a','https://photo.zalo.me:8443/a'])
    await assert.rejects(downloadPublicImage(url));
  await assert.rejects(downloadPublicImage('https://photo.zalo.me/a',async()=>[{address:'127.0.0.1',family:4}]),/public/i);
  await assert.rejects(downloadPublicImage('https://photo.zalo.me/a',async()=>[{address:'169.254.169.254',family:4}]),/public/i);
});
