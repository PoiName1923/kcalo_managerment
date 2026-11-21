const app=document.querySelector('#app');
const state={account:null,bots:[],days:30,bot:'',page:1,version:0};
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const n=value=>Number.isFinite(Number(value))?Number(value):0;
const fmt=value=>new Intl.NumberFormat('vi-VN',{maximumFractionDigits:1}).format(n(value));
const date=value=>new Date(value).toLocaleString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'});
const icons={
  dashboard:'<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="11" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="18" width="7" height="3" rx="1"/>',
  bot:'<rect x="4" y="7" width="16" height="13" rx="4"/><path d="M12 3v4M2 12v4m20-4v4m-14-4h1m6 0h1m-7 4h6"/>',
  users:'<path d="M3 21v-2a6 6 0 0 1 12 0v2m2-14a4 4 0 0 1 0 8m1 3a5 5 0 0 1 3 3"/><circle cx="9" cy="7" r="4"/>',
  user:'<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  shield:'<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z"/><path d="m8 12 3 3 5-6"/>',
  photo:'<rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="8" cy="9" r="1"/><path d="m3 17 5-5 4 4 3-3 6 6"/>',
  chart:'<path d="M4 3v17h17M9 15v-4m5 4V6m5 9V9"/>',
  plus:'<path d="M12 5v14M5 12h14"/>',
  logout:'<path d="M9 4H5v16h4m5-12 4 4-4 4m-5-4h11"/>',
};
const icon=name=>`<svg class="icon" aria-hidden="true" viewBox="0 0 24 24">${icons[name]??icons.chart}</svg>`;
const brand=()=>'<a class="brand" href="/dashboard" data-nav><img src="/favicon.svg" alt=""><span>calo<small>NHẬT KÝ DINH DƯỠNG</small></span></a>';
let toastTimer;
function toast(message,failure=false){const el=document.querySelector('#toast');el.textContent=message;el.className=failure?'failure':'';el.hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.hidden=true,6500);}
async function api(path,options={},retry=true){
  const response=await fetch(path,{credentials:'same-origin',...options,headers:{...(options.body?{'Content-Type':'application/json'}:{}),...options.headers}});
  if(response.status===401 && retry && !path.includes('/api/auth')){
    const refreshed=await fetch('/api/auth?action=refresh',{method:'POST',credentials:'same-origin'});
    if(refreshed.ok)return api(path,options,false);
    state.account=null;login();throw new Error('Phiên đăng nhập hết hạn. Vui lòng đăng nhập lại.');
  }
  const body=await response.json().catch(()=>({error:'Server trả về phản hồi không hợp lệ.'}));
  if(!response.ok)throw new Error(body.error??'Không thể kết nối. Vui lòng thử lại.');
  return body;
}
function post(path,body,method='POST'){return api(path,{method,body:JSON.stringify(body)});}
function login(message=''){
  state.account=null;state.bots=[];state.bot='';state.page=1;state.days=30;state.version++;
  document.querySelector('#toast').hidden=true;document.title='Đăng nhập · Calo';
  if(location.pathname!=='/login')history.replaceState({},'','/login');
  app.innerHTML=`<main class="login" id="main"><section class="login-left">${brand()}<div class="login-form"><h1>Chào mừng trở lại.</h1><p class="muted">Đăng nhập để quản lý bữa ăn của bạn.</p><form id="login-form"><label class="field">Email<input type="email" name="email" autocomplete="username" placeholder="ban@example.com" required maxlength="254"></label><label class="field">Mật khẩu<input type="password" name="password" autocomplete="current-password" placeholder="Nhập mật khẩu của bạn" required maxlength="128"></label><div class="error" role="alert" id="login-error">${esc(message)}</div><button class="btn full" type="submit">Đăng nhập</button></form><p class="subtext" style="margin-top:22px">Chưa có tài khoản hoặc quên mật khẩu? Liên hệ quản trị viên để được cấp quyền truy cập.</p></div><p class="login-footer">Dữ liệu riêng tư. Bắt đầu từ một bữa ăn.</p></section><aside class="login-story"><h2>Ăn gì đấy.<br>Cho ăn ké với.</h2><p>Từ ảnh món ăn trong Telegram hoặc Zalo đến một nhật ký dinh dưỡng có thể theo dõi mỗi ngày.</p>${[['photo','Ghi lại bữa ăn','Chụp ảnh, thêm chú thích và gửi cho bot.'],['bot','Nhận ước tính dinh dưỡng','Khối lượng, calo và các chất dinh dưỡng.'],['chart','Nhìn lại thói quen','Theo dõi lượng đã ghi nhận theo thời gian.']].map(([i,title,text])=>`<div class="story-step">${icon(i)}<div>${title}<small>${text}</small></div></div>`).join('')}</aside></main>`;
}
const routes={'/dashboard':['Tổng quan','dashboard'],'/integrations':['Bot & API','bot'],'/users':['Người dùng','users'],'/account':['Tài khoản','user']};
function shell(){
  const route=routes[location.pathname]?location.pathname:'/dashboard';
  const account=state.account;
  app.innerHTML=`<div class="shell"><aside class="rail">${brand()}<nav class="nav" aria-label="Điều hướng chính">${Object.entries(routes).filter(([p])=>p!=='/users'||account.role==='admin').map(([p,[title,i]])=>`<a href="${p}" data-nav ${route===p?'aria-current="page"':''}>${icon(i)}${title}</a>`).join('')}</nav><div class="rail-note">${icon('shield')}Bot của bạn.<br>Dữ liệu của bạn.<br>Mọi thứ trong một nhật ký.</div></aside><div class="work-area"><header class="topbar"><span>${routes[route][0]}</span><div class="account-menu"><span class="avatar" aria-hidden="true">${esc((account.display_name||account.email).slice(0,1).toUpperCase())}</span><span class="account-name">${esc(account.display_name||account.email)}</span><button class="btn quiet" data-action="logout" aria-label="Đăng xuất">${icon('logout')}<span>Đăng xuất</span></button></div></header><main class="content" id="main"><div class="loading" role="status">Đang tải dữ liệu…</div></main></div></div>`;
  return route;
}
async function render(){
  if(!state.account){login();return;}
  const route=shell(),version=++state.version;
  document.title=`${routes[route][0]} · Calo`;
  try{
    let html;
    if(route==='/dashboard')html=await dashboard();
    else if(route==='/integrations')html=await integrations();
    else if(route==='/users')html=await users();
    else html=accountPage();
    if(version===state.version && state.account)document.querySelector('#main').innerHTML=html;
  }catch(error){
    if(version===state.version && state.account)document.querySelector('#main').innerHTML=`<h1>Chưa tải được dữ liệu</h1><div class="error" role="alert">${esc(error.message)}<br><button class="btn secondary" data-action="reload">Thử lại</button></div>`;
  }
}
const footer=()=>'<footer class="footer"><span>Dinh dưỡng được ước tính từ ảnh, có thể khác với khẩu phần thực tế.</span><span>Múi giờ Việt Nam · UTC+7</span></footer>';
const nutrients=[['Protein','protein_g',4,'#286a4c'],['Carbohydrate','carbs_g',4,'#98652d'],['Chất béo','fat_g',9,'#60753d']];
function chart(daily){
  const map=new Map(daily.map(row=>[row.day.slice(0,10),row]));
  const today=new Date(Date.now()+7*3600000),values=[];
  for(let i=state.days-1;i>=0;i--){const day=new Date(today.getTime()-i*86400000).toISOString().slice(0,10);values.push({day,...map.get(day)});}
  const chartWidth=Math.max(680,state.days*76+104),left=76,h=180,gap=(chartWidth-104)/values.length;
  const energy=row=>nutrients.reduce((sum,[,key,factor])=>sum+n(row[key])*factor,0);
  const max=Math.max(400,Math.ceil(Math.max(...values.map(energy))/400)*400);
  const svg=`<div class="chart-scroll" tabindex="0" role="region" aria-label="Biểu đồ dinh dưỡng, cuộn ngang để xem thêm"><svg class="chart" style="width:${chartWidth}px" role="img" aria-label="Calo đã ghi nhận theo ngày, ${state.days} ngày gần đây" viewBox="0 0 ${chartWidth} 250"><title>Năng lượng từ thành phần dinh dưỡng theo ngày</title>${[0,1,2,3].map(i=>{const y=30+h-i*h/3;return `<line class="grid-line" x1="${left}" x2="${chartWidth-20}" y1="${y}" y2="${y}"/><text text-anchor="end" x="64" y="${y+4}">${fmt(Math.round(max*i/3))}</text>`;}).join('')}${values.map((row,i)=>{
    let base=0;const x=left+i*gap+gap/2,total=energy(row);
    const bars=nutrients.map(([label,key,factor,color])=>{const kcal=n(row[key])*factor,height=kcal/max*h,y=30+h-(base+kcal)/max*h;base+=kcal;return `<rect x="${x-gap*.32}" y="${y}" width="${gap*.64}" height="${height}" fill="${color}"><title>${row.day} · ${label}: ${fmt(row[key])} g · ${fmt(kcal)} kcal</title></rect>${height>=22?`<text class="segment-label" text-anchor="middle" x="${x}" y="${y+height/2+4}">${fmt(kcal)}</text>`:''}`;}).join('');
    return bars+`<text class="data-label" text-anchor="middle" x="${x}" y="${24+h-total/max*h}">${fmt(total)}</text><text text-anchor="middle" x="${x}" y="238">${row.day.slice(8)}/${row.day.slice(5,7)}</text>`;
  }).join('')}</svg></div>`;
  return `<div class="chart-legend">${nutrients.map(([label,,,color])=>`<span class="legend" style="--legend-color:${color}">${label}</span>`).join('')}</div>`+svg+`<p class="chart-caption">Năng lượng quy đổi: Protein và Carbohydrate 4 kcal/g; Chất béo 9 kcal/g. Nhãn hiển thị kcal, có thể khác tổng kcal ước tính.</p><details><summary>Xem bảng số liệu theo ngày</summary><div class="table-wrap daily-table-wrap" tabindex="0" role="region" aria-label="Số liệu dinh dưỡng theo ngày"><table class="data-table"><thead><tr><th>Ngày</th><th class="numeric">Bữa ăn</th><th class="numeric">kcal</th>${nutrients.map(([label])=>`<th class="numeric">${label} (g)</th>`).join('')}<th>Chi tiết</th></tr></thead><tbody>${values.slice().reverse().map(row=>`<tr><td>${row.day}</td><td class="numeric">${fmt(row.meal_count)}</td><td class="numeric">${fmt(row.kcal)}</td>${nutrients.map(([,key])=>`<td class="numeric">${fmt(row[key])}</td>`).join('')}<td><button class="btn quiet" data-action="view-day" data-day="${row.day}" aria-label="Xem bữa ăn ngày ${row.day}">Xem bữa ăn</button></td></tr>`).join('')}</tbody></table></div></details><section id="day-detail" tabindex="-1" aria-live="polite"></section>`;
}
async function showDay(button){
  const target=document.querySelector('#day-detail'),version=state.version,day=button.dataset.day;
  target.dataset.day=day;button.disabled=true;target.innerHTML='<div class="loading" role="status">Đang tải bữa ăn…</div>';
  try{
    const data=await api(`/api/dashboard?day=${day}${state.bot?'&bot='+encodeURIComponent(state.bot):''}`);
    if(version!==state.version||!state.account||target.dataset.day!==day)return;
    target.innerHTML=`<h3>Bữa ăn ngày ${esc(day)}</h3>${data.meals.length?data.meals.map(meal=>`<article class="day-meal"><h4>${esc(date(meal.created_at))}</h4><p>${fmt(meal.estimate.totals?.kcal)} kcal · Protein ${fmt(meal.estimate.totals?.protein_g)} g · Carbohydrate ${fmt(meal.estimate.totals?.carbs_g)} g · Chất béo ${fmt(meal.estimate.totals?.fat_g)} g</p><ul>${(meal.estimate.items??[]).map(item=>`<li><strong>${esc(item.name)}</strong>: ${fmt(item.kcal)} kcal · Protein ${fmt(item.protein_g)} g · Carbohydrate ${fmt(item.carbs_g)} g · Chất béo ${fmt(item.fat_g)} g</li>`).join('')}</ul></article>`).join(''):'<p class="empty">Không có bữa ăn được ghi nhận trong ngày này.</p>'}`;
    target.focus();target.scrollIntoView({block:'nearest'});
  }catch(error){if(version===state.version&&state.account&&target.dataset.day===day)target.innerHTML=`<div class="error" role="alert">${esc(error.message)} Hãy bấm Xem bữa ăn để thử lại.</div>`;}finally{button.disabled=false;}
}
async function dashboard(){
  const data=await api(`/api/dashboard?days=${state.days}${state.bot?'&bot='+encodeURIComponent(state.bot):''}`);state.bots=data.bots;
  const daily=data.stats.daily??[],totals=daily.reduce((a,d)=>{for(const k of ['meal_count','kcal','protein_g','carbs_g','fat_g'])a[k]+=n(d[k]);return a;},{meal_count:0,kcal:0,protein_g:0,carbs_g:0,fat_g:0});
  const all=data.stats.all_time??{},usage=data.stats.usage??{},macroTotal=totals.protein_g+totals.carbs_g+totals.fat_g;
  const metrics=[['Năng lượng đã ghi nhận',fmt(totals.kcal),'kcal',`${state.days} ngày gần đây`],['Bữa ăn đã ghi nhận',fmt(totals.meal_count),'bữa','Từ ảnh gửi qua bot'],['Trung bình mỗi ngày',fmt(totals.kcal/state.days),'kcal','Tính cả ngày chưa ghi nhận'],['Tổng từ khi bắt đầu',fmt(all.kcal),'kcal',`${fmt(all.meals)} bữa · gồm cả dữ liệu archive`]];
  return `<div class="page-head"><div><h1>Bức tranh dinh dưỡng của bạn</h1><p>Nhìn lại những bữa ăn đã ghi nhận, từng ngày một.</p></div><div class="toolbar"><select class="control" id="filter-bot" aria-label="Lọc theo bot"><option value="">Tất cả bot</option>${data.bots.map(b=>`<option value="${esc(b.id)}" ${state.bot===b.id?'selected':''}>${esc(b.name)}</option>`).join('')}</select><select class="control" id="filter-days" aria-label="Khoảng thời gian">${[7,30,90].map(d=>`<option value="${d}" ${state.days===d?'selected':''}>${d} ngày gần đây</option>`).join('')}</select></div></div>
    ${!data.bots.length?`<section class="panel empty"><h2>Bắt đầu nhật ký đầu tiên</h2><p>Kết nối bot Telegram và Gemini API của bạn.<br>Gửi một ảnh món ăn để số liệu xuất hiện ở đây.</p><a class="btn" href="/integrations" data-nav>${icon('plus')}Kết nối bot</a></section>`:''}
    <section class="metrics" aria-label="Số liệu tổng quan">${metrics.map(([label,value,unit,note])=>`<div class="metric"><p class="metric-label">${label}</p><p class="metric-value">${value}<span>${unit}</span></p><p class="metric-foot">${note}</p></div>`).join('')}</section>
    <div class="analytics"><section class="panel"><div class="panel-head"><div><h2>Năng lượng theo ngày</h2><p>Những ngày không ghi nhận được hiển thị bằng 0.</p></div></div>${chart(daily)}</section><section class="panel"><div class="panel-head"><div><h2>Thành phần dinh dưỡng</h2><p>Tổng lượng trong ${state.days} ngày</p></div></div>${[['Protein','protein_g'],['Carbohydrate','carbs_g'],['Chất béo','fat_g']].map(([label,key])=>`<div class="macro"><div class="macro-name"><span>${label}</span><strong>${fmt(totals[key])} g</strong></div><div class="macro-track"><div class="macro-fill" style="width:${macroTotal?totals[key]/macroTotal*100:0}%"></div></div></div>`).join('')}<p class="summary-note">Thanh biểu thị tỷ trọng theo khối lượng các chất đã ghi nhận, không phải mục tiêu dinh dưỡng.</p></section></div>
    <section class="panel"><div class="panel-head"><div><h2>Những bữa ăn gần đây</h2><p>Chi tiết được giữ 30 ngày trước khi chuyển sang archive.</p></div><span class="badge neutral">${data.recent.length} bữa gần nhất</span></div>${data.recent.length?`<div class="table-wrap"><table class="data-table"><thead><tr><th>Món ăn</th><th>Thời gian</th><th class="numeric">Năng lượng</th><th class="numeric">P / C / F (g)</th><th>Ước tính</th></tr></thead><tbody>${data.recent.map(m=>`<tr><td><div class="meal-title">${esc((m.estimate.items??[]).map(i=>i.name).join(', '))}</div><span class="subtext">${esc(data.bots.find(b=>b.id===m.bot_id)?.name??'Bot nhận ảnh')}</span></td><td>${esc(date(m.created_at))}</td><td class="numeric"><strong>${fmt(m.estimate.totals?.kcal)}</strong> kcal</td><td class="numeric">${fmt(m.estimate.totals?.protein_g)} / ${fmt(m.estimate.totals?.carbs_g)} / ${fmt(m.estimate.totals?.fat_g)}</td><td><span class="badge ${m.estimate.confidence==='low'?'off':''}">${{high:'Cao',medium:'Trung bình',low:'Thấp'}[m.estimate.confidence]??'Chưa rõ'}</span></td></tr>`).join('')}</tbody></table></div>`:'<div class="empty">Chưa có bữa ăn gần đây. Gửi ảnh món ăn cho bot đã kết nối để bắt đầu.</div>'}</section>
    <div class="usage-strip"><span>Gemini trong kỳ: <strong>${fmt(usage.calls)} lượt gọi</strong></span><span>Phân tích thành công: <strong>${fmt(usage.successes)}</strong></span><span>Token được API báo cáo: <strong>${fmt(usage.total_tokens)}</strong></span></div>${footer()}`;
}
const providerName=bot=>bot.provider==='zalo'?'Zalo Bot':'Telegram';
function integrationForm(bot,provider=bot?.provider??'telegram'){
  const zalo=provider==='zalo';
  return `<h2>${bot?'Chỉnh sửa cấu hình':'Thêm bot của bạn'}</h2>
  <p class="muted subtext" style="margin:10px 0 24px">Chọn Telegram hoặc Zalo Bot. Mỗi cấu hình dùng Gemini key và User ID người gửi riêng.</p>
  <form id="integration-form" method="post"><input type="hidden" name="id" value="${esc(bot?.id??'')}">
  ${bot?`<input type="hidden" name="provider" value="${esc(provider)}">`:''}
  <div class="form-grid">
  <label class="field wide">Kênh nhận ảnh<select class="control" name="provider" id="integration-provider" ${bot?'disabled':''}>
    <option value="telegram" ${!zalo?'selected':''}>Telegram</option><option value="zalo" ${zalo?'selected':''}>Zalo Bot</option>
  </select><small>${bot?'Kênh của bot đã lưu được giữ cố định. Để dùng kênh khác, hãy thêm cấu hình mới.':'Bạn có thể thêm cả hai kênh bằng hai cấu hình bot riêng.'}</small></label>
  <label class="field wide">Tên gợi nhớ<input name="name" required maxlength="80" placeholder="Ví dụ: Nhật ký của tôi" value="${esc(bot?.name??'')}"></label>
  <label class="field">${zalo?'Zalo User ID':'Telegram User ID'}<input name="allowed_user_id" inputmode="${zalo?'text':'numeric'}" pattern="${zalo?'[A-Za-z0-9._-]+':'[0-9]+'}" maxlength="128" required placeholder="${zalo?'Ví dụ: 6ede9afa66b88fe6d6a9':'Ví dụ: 123456789'}" value="${esc(bot?.allowed_user_id??bot?.telegram_user_id??'')}"><small>ID tài khoản gửi ảnh, không phải username hay ID bot.</small></label>
  <label class="field">Gemini model<input name="gemini_model" required pattern="[A-Za-z0-9._-]+" maxlength="100" value="${esc(bot?.gemini_model??'gemini-3.5-flash-lite')}"></label>
  <label class="field wide">${zalo?'Zalo Bot Token':'Telegram bot token'}<input type="password" name="bot_token" autocomplete="new-password" maxlength="256" ${bot?'':'required'} placeholder="${bot?'Đã lưu · để trống để giữ nguyên':zalo?'Token từ Zalo Bot Creator':'Token được cấp bởi BotFather'}"><small>Token chỉ được gửi đến server khi bạn lưu cấu hình.</small></label>
  <label class="field wide">Gemini API key<input type="password" name="gemini_key" autocomplete="new-password" maxlength="256" ${bot?'':'required'} placeholder="${bot?'Đã lưu · để trống để giữ nguyên':'API key trong Google AI Studio'}"></label>
  </div><div class="error" role="alert" id="integration-error"></div><div class="form-actions"><button type="submit" class="btn">Lưu cấu hình</button>${bot?'<button type="button" class="btn secondary" data-action="cancel-edit">Huỷ chỉnh sửa</button>':''}</div></form>`;
}
async function integrations(){
  const data=await api('/api/integrations');state.bots=data.bots;
  return `<div class="page-head"><div><h1>Kết nối theo cách của bạn</h1><p>Telegram hoặc Zalo Bot, cùng một nhật ký dinh dưỡng.</p></div><span class="badge neutral">${data.bots.length} bot đã thêm</span></div>
  <div class="settings-layout"><div class="bot-list">${data.bots.map(b=>`<article class="bot-row"><div class="bot-title"><div><h3>${esc(b.name)}</h3>${b.provider==='zalo'?`<span class="muted">${esc(b.bot_username)}</span>`:`<a href="https://t.me/${encodeURIComponent(b.bot_username)}" target="_blank" rel="noopener noreferrer">@${esc(b.bot_username)}</a>`}</div><span class="badge ${b.enabled?'':'off'}">${b.enabled?'Đang hoạt động':b.connected_at?'Đã tạm dừng':'Chưa kết nối'}</span></div>
    <div class="bot-meta"><span class="badge neutral">${providerName(b)}</span><span>ID người gửi: ${esc(b.allowed_user_id??b.telegram_user_id)}</span><span>${esc(b.gemini_model)}</span><span>${b.has_gemini_key?'Gemini key đã mã hoá':'Chưa có Gemini key'}</span></div>
    <div class="bot-actions"><button class="btn secondary" data-action="edit-bot" data-id="${esc(b.id)}">Chỉnh sửa</button><button class="btn quiet" data-action="test-bot" data-id="${esc(b.id)}">Kiểm tra API</button><button class="btn quiet" data-action="connect-bot" data-id="${esc(b.id)}">${b.connected_at?'Kết nối lại':`Kết nối ${providerName(b)}`}</button>${b.enabled?`<button class="btn quiet" data-action="disable-bot" data-id="${esc(b.id)}">Tạm dừng</button>`:''}</div></article>`).join('')}</div>
  <section class="panel" id="integration-editor">${integrationForm(null)}</section><aside class="aside-help"><h2>Chọn kênh bạn hay dùng</h2><p>Với Telegram, lấy token từ <a href="https://t.me/BotFather" target="_blank" rel="noopener noreferrer">BotFather</a>. Với Zalo, tạo bot và lấy token bằng <a href="https://docs.zaloplatforms.com/docs/BOT" target="_blank" rel="noopener noreferrer">Zalo Bot Creator</a>.</p><p>Cả hai kênh dùng Gemini key từ <a href="https://aistudio.google.com/" target="_blank" rel="noopener noreferrer">Google AI Studio</a>.</p><ul><li>Lưu cấu hình rồi bấm <strong>Kết nối</strong> trên bot để đăng ký webhook.</li><li>Mở bot, gửi <strong>/start</strong> rồi gửi ảnh món ăn.</li><li>Điền đúng User ID của tài khoản gửi ảnh. ID Zalo có thể chứa chữ và phải giữ nguyên.</li><li>Để trống token/key khi chỉnh sửa nếu bạn muốn giữ cấu hình cũ.</li></ul><div class="secret-hint">${icon('shield')}<span>Khoá được mã hoá trên server. Giao diện không đọc lại token hoặc API key đã lưu.</span></div><p class="subtext">Ảnh được xoá sau 30 ngày. Số liệu thống kê vẫn còn sau khi lưu trữ chi tiết.</p></aside></div>${footer()}`;
}
async function users(){
  if(state.account.role!=='admin')return '<h1>Bạn không có quyền quản trị</h1><p class="muted">Trang này dành cho quản trị viên.</p>';
  const data=await api(`/api/users?page=${state.page}`);
  return `<div class="page-head"><div><h1>Quản lý người dùng</h1><p>Cấp tài khoản và kiểm soát quyền truy cập ứng dụng.</p></div><span class="badge neutral">${fmt(data.total)} tài khoản</span></div><div class="settings-layout"><section class="panel"><div class="panel-head"><div><h2>Tài khoản trong hệ thống</h2><p>Mỗi người dùng quản lý cấu hình bot và API của riêng mình.</p></div></div><div class="table-wrap"><table class="data-table"><thead><tr><th>Người dùng</th><th>Vai trò</th><th class="numeric">Bot</th><th>Trạng thái</th><th>Thao tác</th></tr></thead><tbody>${data.users.map(u=>`<tr><td><strong>${esc(u.display_name||'Chưa đặt tên')}</strong><div class="subtext">${esc(u.email)}</div></td><td>${u.role==='admin'?'Quản trị viên':'Người dùng'}</td><td class="numeric">${fmt(u.bot_count)}</td><td><span class="badge ${u.active?'':'off'}">${u.active?'Đang hoạt động':'Đã tạm khoá'}</span></td><td>${u.id===state.account.id?'<span class="subtext">Tài khoản của bạn</span>':`<button class="btn quiet" data-action="toggle-user" data-id="${esc(u.id)}" data-active="${!u.active}">${u.active?'Tạm khoá':'Kích hoạt'}</button>`}</td></tr>`).join('')}</tbody></table></div><div class="pagination"><button class="btn quiet" data-action="previous-users" ${state.page===1?'disabled':''}>Trang trước</button><span>Trang ${state.page}</span><button class="btn quiet" data-action="next-users" ${state.page*50>=data.total?'disabled':''}>Trang sau</button></div></section><section class="panel"><h2>Tạo tài khoản</h2><form id="user-form" style="margin-top:24px"><div class="form-grid"><label class="field">Tên hiển thị<input name="display_name" required maxlength="100" autocomplete="off"></label><label class="field">Email<input type="email" name="email" required maxlength="254" autocomplete="off"></label><label class="field wide">Mật khẩu ban đầu<input type="password" name="password" required minlength="12" maxlength="128" autocomplete="new-password"><small>Ít nhất 12 ký tự. Gửi mật khẩu cho người dùng qua kênh riêng; họ có thể đổi trong trang Tài khoản.</small></label></div><div class="error" role="alert" id="user-error"></div><button type="submit" class="btn">Tạo người dùng</button></form></section><aside class="aside-help"><h2>Quyền rõ ràng, dữ liệu riêng tư</h2><p>Người dùng chỉ xem thống kê và thay đổi cấu hình thuộc tài khoản của họ.</p><p>Tạm khoá sẽ chặn truy cập web và ngừng nhận tác vụ mới từ các bot của tài khoản đó.</p><p class="subtext">Quyền quản trị viên được cấp bởi người vận hành trong database. Trang này không hiển thị khoá bí mật của người dùng.</p></aside></div>${footer()}`;
}
function accountPage(){const a=state.account;return `<div class="page-head"><div><h1>Tài khoản của bạn</h1><p>Thông tin đăng nhập và bảo mật.</p></div></div><section class="panel account-panel"><h2>Thông tin tài khoản</h2><dl class="account-facts"><dt>Tên</dt><dd>${esc(a.display_name)}</dd><dt>Email</dt><dd>${esc(a.email)}</dd><dt>Vai trò</dt><dd>${a.role==='admin'?'Quản trị viên':'Người dùng'}</dd></dl><h2>Đổi mật khẩu</h2><form id="password-form" style="margin-top:24px"><label class="field">Mật khẩu mới<input type="password" name="password" required minlength="12" maxlength="128" autocomplete="new-password"><small>Ít nhất 12 ký tự.</small></label><label class="field">Nhập lại mật khẩu<input type="password" name="confirm" required minlength="12" maxlength="128" autocomplete="new-password"></label><div class="error" role="alert" id="password-error"></div><button class="btn" type="submit">Đổi mật khẩu</button></form></section>${footer()}`;}
function go(path){history.pushState({},'',path);window.scrollTo(0,0);render();}
document.addEventListener('click',async event=>{
  const link=event.target.closest('[data-nav]');
  if(link && !event.ctrlKey && !event.metaKey && !event.shiftKey){event.preventDefault();if(state.account)go(link.getAttribute('href'));return;}
  const button=event.target.closest('button[data-action]');if(!button || button.disabled)return;
  const action=button.dataset.action,id=button.dataset.id;
  if(action==='view-day'){await showDay(button);return;}
  if(action==='reload'){render();return;}
  if(action==='edit-bot'){document.querySelector('#integration-editor').innerHTML=integrationForm(state.bots.find(b=>b.id===id));document.querySelector('#integration-editor').scrollIntoView({behavior:'smooth',block:'start'});document.querySelector('#integration-form input[name=name]').focus({preventScroll:true});return;}
  if(action==='cancel-edit'){document.querySelector('#integration-editor').innerHTML=integrationForm(null);return;}
  if(action==='previous-users'||action==='next-users'){state.page+=action==='next-users'?1:-1;render();return;}
  if(action==='toggle-user' && button.dataset.active==='false' && !confirm('Tạm khoá quyền truy cập và bot của tài khoản này?'))return;
  if(action==='connect-bot' && !confirm('Đăng ký webhook cho bot này với ứng dụng Calo? Webhook hiện có của bot sẽ được thay thế.'))return;
  button.disabled=true;
  try{
    if(action==='logout'){await post('/api/auth?action=logout',{});login();return;}
    if(action==='toggle-user'){await post('/api/users',{id,active:button.dataset.active==='true'},'PATCH');toast('Đã cập nhật trạng thái tài khoản.');}
    else if(['test-bot','connect-bot','disable-bot'].includes(action)){const result=await post(`/api/integrations?action=${action.split('-')[0]}`,{id});toast(result.message??(action==='disable-bot'?'Đã tạm dừng bot.':'Đã kết nối kênh nhận ảnh.'));}
    if(action!=='test-bot')await render();
  }catch(error){toast(error.message,true);}finally{button.disabled=false;}
});
document.addEventListener('change',event=>{
  if(event.target.id==='filter-days'){state.days=Number(event.target.value);render();}
  if(event.target.id==='filter-bot'){state.bot=event.target.value;render();}
  if(event.target.id==='integration-provider'){
    const values=Object.fromEntries(new FormData(event.target.form)),provider=event.target.value;
    document.querySelector('#integration-editor').innerHTML=integrationForm(null,provider);
    for(const name of ['name','gemini_model','gemini_key'])document.querySelector(`#integration-form [name="${name}"]`).value=values[name]??'';
  }
});
document.addEventListener('submit',async event=>{
  const form=event.target,formId=form.getAttribute('id');if(!['login-form','integration-form','user-form','password-form'].includes(formId))return;
  event.preventDefault();const data=Object.fromEntries(new FormData(form)),button=form.querySelector('[type=submit]'),errorBox=form.querySelector('.error'),label=button.textContent;
  errorBox.textContent='';button.disabled=true;button.textContent='Đang xử lý…';
  try{
    if(formId==='login-form'){const result=await post('/api/auth?action=login',data);state.account=result.account;go('/dashboard');}
    else if(formId==='integration-form'){if(!data.id)delete data.id;await post('/api/integrations',data);toast('Đã lưu cấu hình. Bấm Kết nối trên bot để bật kênh nhận ảnh.');await render();}
    else if(formId==='user-form'){await post('/api/users',data);toast('Đã tạo tài khoản người dùng.');state.page=1;await render();}
    else{if(data.password!==data.confirm)throw new Error('Hai mật khẩu chưa trùng nhau.');await post('/api/auth?action=password',{password:data.password});form.reset();toast('Đã đổi mật khẩu.');}
  }catch(error){errorBox.textContent=error.message;}finally{button.disabled=false;button.textContent=label;}
});
window.addEventListener('popstate',()=>state.account?render():login());
async function boot(){
  try{let response=await fetch('/api/auth?action=me',{credentials:'same-origin'});if(response.status===401){const refresh=await fetch('/api/auth?action=refresh',{method:'POST',credentials:'same-origin'});if(refresh.ok)response=await fetch('/api/auth?action=me',{credentials:'same-origin'});}
    if(!response.ok){login(response.status===401?'':'Không tải được phiên đăng nhập. Vui lòng thử đăng nhập hoặc liên hệ quản trị viên.');return;}
    state.account=(await response.json()).account;if(location.pathname==='/login'||location.pathname==='/')history.replaceState({},'','/dashboard');render();
  }catch{login('Không kết nối được đến ứng dụng. Kiểm tra mạng và thử lại.');}
}
boot();
