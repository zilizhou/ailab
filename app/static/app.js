'use strict';
const $ = s => document.querySelector(s);
const root = $('#app');
const S = {data:null, view:'overview', gid:null, draft:null, raw:'', conclusion:'', message:'', feedback:'', assist:null, question:'', assistTarget:'', modal:null, error:'', online:true, busy:false, loginRole:'student', loginUser:'student1', loginPassword:'Lab2026!', pending:[], revisionReason:'', helpText:'', photoCaption:''};
const paths = {lab:'M7 3v5l-4 9a3 3 0 0 0 3 4h12a3 3 0 0 0 3-4l-4-9V3M5 3h14M7 14h10',spark:'m12 3 2.7 6.3L21 12l-6.3 2.7L12 21l-2.7-6.3L3 12l6.3-2.7L12 3',grid:'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z',chart:'M4 3v17h17M7 14l4-5 4 3 5-7',book:'M4 4h6l2 2 2-2h6v16h-6l-2 1-2-1H4V4M12 6v15',check:'m5 12 4 4L19 6',send:'m3 3 18 9-18 9 4-9-4-9M7 12h14',chat:'M21 11a8 8 0 0 1-8 8H8l-5 3V11a9 9 0 0 1 18 0',user:'M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0M4 21v-2a8 8 0 0 1 16 0v2',users:'M15 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0M3 21v-2a8 8 0 0 1 14-5M20 21v-3a5 5 0 0 0-3-4M18 3a4 4 0 0 1 0 8',file:'M5 3h9l5 5v13H5V3M14 3v6h5M8 13h8M8 17h5',clock:'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0M12 7v5l3 2',camera:'M3 7h4l2-3h6l2 3h4v14H3V7M16 13a4 4 0 1 1-8 0 4 4 0 0 1 8 0',close:'m6 6 12 12M6 18 18 6',back:'m14 5-7 7 7 7M7 12h14',help:'M9 8a3 3 0 1 1 5 2c-2 1-2 2-2 4M12 18h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0',refresh:'M20 4v5h-5M4 20v-5h5M5 8a8 8 0 0 1 13-4l2 5M4 15l2 5a8 8 0 0 0 13-4',circuit:'M3 6h5l2-3 4 6 2-3h5M3 18h5l2-3 4 6 2-3h5M3 6v12M21 6v12'};
const I = name => `<svg class="icon" aria-hidden="true" viewBox="0 0 24 24"><path d="${paths[name]||paths.lab}"/></svg>`;
const E = value => String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const P = (text,color='') => `<span class="pill ${color}">${E(text)}</span>`;
const B = (label,action,style='btn',icon='',extra='') => `<button type="button" class="${style}" data-action="${action}" ${extra} ${S.busy?'disabled':''}>${icon?I(icon):''}${E(label)}</button>`;
const fmt = n => n==null?'—':Number(n).toFixed(3).replace(/0+$/,'').replace(/\.$/,'');
const statusLabels = {working:'进行中',submitted:'待复核',returned:'待补充',reviewed:'已反馈'};
const current = () => S.data.groups.find(g=>g.id===S.gid)||S.data.groups[0];
const isTeacher = () => S.data?.user.role==='teacher';
const locked = g => ['submitted','reviewed'].includes(g.status);
const lastSubmission = g => g.events.filter(e=>e.kind==='submission').at(-1);
const titleByKind = {measurement:'确认测量',observation:'观察与提问',revision:'修改实物',message:'教师指导',help:'向教师求助',submission:'提交实验结论',review:'教师反馈',photo:'实验照片'};
const key = what => `lab:${S.data.user.id}:${what}`;
// getRandomValues also works over an intranet HTTP origin; randomUUID/subtle may not.
function operationId(){
  const bytes=crypto.getRandomValues(new Uint8Array(16));
  bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;
  const hex=Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}
async function operationFingerprint(text){
  if(crypto.subtle){
    const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text));
    return Array.from(new Uint8Array(digest),x=>x.toString(16).padStart(2,'0')).join('');
  }
  // Local retry-cache index only. Authentication and payload validation stay on the server.
  let a=0x811c9dc5,b=0x9e3779b9;
  for(let i=0;i<text.length;i++){const code=text.charCodeAt(i);a=Math.imul(a^code,0x01000193);b=Math.imul(b^code,0x85ebca6b)}
  return `${text.length}:${(a>>>0).toString(16)}:${(b>>>0).toString(16)}`;
}

function toast(message){const t=$('#toast');t.textContent=message;t.classList.add('show');clearTimeout(toast.timer);toast.timer=setTimeout(()=>t.classList.remove('show'),3500)}
async function api(path, data){
  // A retry after a lost response reuses the server operation id, including after a reload.
  let operationKey=null, outbox={};
  if(data?.nonce&&S.data){
    const {nonce,...payload}=data;
    operationKey=await operationFingerprint(path+JSON.stringify(payload));
    outbox=JSON.parse(localStorage.getItem(key('operations'))||'{}');
    data.nonce=outbox[operationKey]||nonce;outbox[operationKey]=data.nonce;
    localStorage.setItem(key('operations'),JSON.stringify(outbox));
  }
  let response;
  try{response=await fetch('/api'+path,{method:data?'POST':'GET',headers:data?{'Content-Type':'application/json'}:{},body:data?JSON.stringify(data):undefined,credentials:'same-origin'});}catch(error){error.network=true;throw error}
  const result=await response.json();
  if(operationKey&&(response.ok||response.status<500)){delete outbox[operationKey];localStorage.setItem(key('operations'),JSON.stringify(outbox))}
  if(!response.ok){const e=new Error(typeof result.detail==='string'?result.detail:'请求内容无效，请核对后重试');e.status=response.status;throw e}
  return result;
}
const command = data => ({nonce:operationId(),...data});
function persistPending(){localStorage.setItem(key('pending'),JSON.stringify(S.pending))}
function stashText(){if(!S.raw.trim())return;S.pending.push({id:operationId(),text:S.raw,revision:current().revision,group:current().id});persistPending();S.raw='';toast('文字已暂存本机，联网后需重新提取并确认')}
function capture(){
  const fields={raw:'#raw',conclusion:'#conclusion',message:'#message',feedback:'#feedback',question:'#question',assistTarget:'#assist-target',loginUser:'#username',loginPassword:'#password',revisionReason:'#revision-reason',helpText:'#help-text',photoCaption:'#photo-caption'};
  for(const [name,selector] of Object.entries(fields)){const el=$(selector);if(el)S[name]=el.value}
  if(S.draft){for(const f of ['vin','vout']){const el=$('#edit-'+f);if(el){S.draft[f].raw=el.value;S.draft[f].unit=$('#unit-'+f).value}}if($('#reference'))S.draft.reference=$('#reference').value;S.draft.acknowledged=!!$('#acknowledged')?.checked}
  if(S.assist&&$('#assist-text'))S.assist.text=$('#assist-text').value;
}
async function refresh(renderNow=true){
  const wasOnline=S.online;
  const before=JSON.stringify(S.data);
  const data=await api('/state');
  // Server clock alone does not trigger a render.
  delete data.server_time;
  S.data=data;S.online=true;
  if(!S.gid||!data.groups.some(g=>g.id===S.gid))S.gid=data.groups[0]?.id;
  if(S.draft&&S.draft.revision!==current().revision){S.draft=null;S.error='实物修订已更新，旧草稿已撤下。请按当前接线重新测量。'}
  if(S.busy)return;
  if(renderNow||before!==JSON.stringify(data)||!wasOnline||S.renderPending){
    if(renderNow||!document.activeElement?.matches('textarea,input,select')){capture();render()}
    else S.renderPending=true;
  }
}
function render(){
  S.renderPending=false;
  root.innerHTML=S.data?shell():login();
  if(S.modal)root.insertAdjacentHTML('beforeend',dialog());
  if(S.modal)setTimeout(()=>$('.dialog input,.dialog textarea,.dialog button')?.focus(),0);
}

function login(){return `<main class="login"><section class="login-story"><div class="brand"><span class="mark">${I('circuit')}</span>知实验</div><div class="story-copy"><div class="eyebrow">AI 实验助教</div><h1>让每一次测量，<br>都成为<span>理解的开始。</span></h1><p>把实验发现说出来，让助教整理证据。<br>把时间留给思考、探索和面对面的指导。</p><svg class="circuit" viewBox="0 0 440 210" role="img" aria-label="电阻分压示意图"><g stroke="#7395cc" stroke-width="2" fill="none"><path d="M80 30h140v22m0 40v25m0 40v23H80V30m140 87h130"/><path d="m220 52-9 5 18 8-18 8 18 8-9 11m0 25-9 5 18 8-18 8 18 8-9 11"/><circle cx="80" cy="103" r="23" fill="#f0f5ff"/><path d="M73 98h14m-7-7v14m-7 9h14"/><circle cx="220" cy="117" r="4" fill="#2868e8" stroke="#2868e8"/><circle cx="350" cy="117" r="4" fill="white"/></g><g fill="#54729f" font-size="14" font-family="sans-serif"><text x="38" y="149">3.3 V</text><text x="245" y="75">R1 · 10 kΩ</text><text x="245" y="151">R2 · 10 kΩ</text><text x="321" y="97">TP2</text><text x="189" y="203">TP0</text><text x="187" y="20">TP1</text></g></svg></div><div class="story-foot">电子电路先行 · 为更多学科实验预留空间</div></section><section class="login-form"><form class="login-inner" id="login-form"><h2>进入教学空间</h2><p class="muted">记录真实过程，连接每一次教与学。</p><div class="login-roles" aria-label="选择试用账号">${['student','teacher'].map(r=>`<button type="button" class="${S.loginRole===r?'on':''}" data-action="login-role:${r}">${I(r==='student'?'user':'book')}${r==='student'?'学生端':'教师端'}</button>`).join('')}</div><div class="field"><label for="username">账号</label><input id="username" autocomplete="username" required value="${E(S.loginUser)}"></div><div class="field"><label for="password">密码</label><input id="password" type="password" autocomplete="current-password" required value="${E(S.loginPassword)}"></div>${S.error?`<div class="error" role="alert">${E(S.error)}</div>`:''}<button class="primary wide" type="submit" ${S.busy?'disabled':''}>${S.busy?'正在登录…':'进入工作台'}</button><div class="demo-note"><strong>教学试用版</strong><br>教师 <code>teacher</code> · 学生 <code>student1 / student2</code><br>试用密码均为 <code>Lab2026!</code>。两个学生账号属于不同小组。</div></form></section></main>`}
function header(){return `<header class="header"><div class="brand"><span class="mark">${I('circuit')}</span>知实验<small>${isTeacher()?'教师工作台':'学生实验空间'}</small></div><div class="user"><span class="avatar">${E(S.data.user.name[0])}</span><span class="username">${E(S.data.user.name)}</span>${B('退出','logout','link')}</div></header>`}
function shell(){return `${header()}${isTeacher()?`<div class="shell">${sidebar()}<main class="main">${connection()}${teacherView()}${S.error?`<div class="error" role="alert">${E(S.error)}</div>`:''}</main></div>`:`<main class="main student-main">${connection()}${studentNav()}${studentView()}${S.error?`<div class="error" role="alert">${E(S.error)}</div>`:''}</main>`}`}
function connection(){return `<div class="connectionbar"><span class="connection ${S.online?'':'off'}">${S.online?'已连接 · 记录已同步至服务器':'连接中断 · 输入可暂存本机'}</span><span class="muted">教学试用 · ${S.data.model_configured?'模型已配置':'规则助教模式'}</span></div>`}
function sidebar(){return `<aside class="sidebar"><div class="sidelabel">教学空间</div>${[['overview','课堂总览','grid'],['assist','AI 助教','spark'],['reports','实验提交','file'],['experiment','实验模板','lab']].map(([id,l,i])=>`<button class="navitem ${S.view===id||(id==='overview'&&S.view==='group')?'on':''}" data-action="view:${id}">${I(i)}${l}</button>`).join('')}<div class="sidefoot">电子电路基础<br>教学试用班<br><br>当前实验包 v0.1<br>2026 秋季学期</div></aside>`}
function studentNav(){return `<nav class="student-nav" aria-label="学生导航">${[['lab','实验','chat'],['records','过程记录','chart'],['submit','实验结论','file']].map(([id,l,i])=>`<button class="${S.view===id?'on':''}" data-action="view:${id}">${I(i)}${l}</button>`).join('')}</nav>`}
function heading(title,description,actions=''){return `<div class="heading"><div><h1>${E(title)}</h1><p>${E(description)}</p></div>${actions}</div>`}
function teacherView(){return ({overview:overview,group:groupView,assist:assistPage,reports:reports,experiment:experimentPage}[S.view]||overview)()}
function studentView(){return ({lab:studentLab,records:studentRecords,submit:studentSubmit}[S.view]||studentLab)()}

function overview(){
  const gs=S.data.groups, submitted=gs.filter(g=>['submitted','reviewed'].includes(g.status)).length, help=gs.filter(g=>g.help).length, active=gs.filter(g=>g.latest).length;
  const attention=gs.filter(g=>g.help||g.latest&&g.latest.data.assessment.code!=='pass');
  return `${heading('课堂总览','电阻分压实验 · '+S.data.course.title,B('生成课堂小结','class-summary','btn','spark'))}<div class="stats">${[[gs.length,'实验小组','users','组'],[active,'已有当前测量','chart','组'],[help,'主动求助','help','组'],[submitted,'已提交','file','组']].map(([n,l,i,u])=>`<div class="stat"><div class="statlabel">${l}${I(i)}</div><strong>${n}</strong><small>${u}</small></div>`).join('')}</div><section class="ai-panel"><div class="ai-title"><span class="ai-icon">${I('spark')}</span><h2>把课堂记录，变成指导线索</h2>${P('基于已确认记录','blue')}</div><p>${help?`${help} 个小组正在求助。`:''}${attention.length?`${attention.length} 个小组有待核对的测量或求助。`:'当前没有已记录的异常或求助。'}已同步的 ${gs.reduce((n,g)=>n+g.events.filter(e=>e.kind==='measurement').length,0)} 次测量可追溯原话和修订。未记录的操作不计作未完成。</p><div class="actions">${B('准备分组指导','view:assist','primary','spark')}${B('复核实验提交','view:reports','btn')}</div></section><div class="twocol" style="margin-bottom:25px"><section class="panel"><div class="panelhead"><h2>课堂进展</h2>${P('实时记录')}</div>${progressBars(gs)}<p class="chart-note">按小组当前状态统计，提交后由教师复核。</p></section><section class="panel"><div class="panelhead"><h2>建议优先关注</h2>${P('教师决定')}</div>${attention.length?attention.slice(0,3).map(g=>`<div class="priority"><div class="row"><h3>${E(g.name)}</h3>${P(g.help?'主动求助':g.latest.data.assessment.label,'amber')}</div><p>${g.latest?'实物修订 '+g.revision+' · 最近输出 '+fmt(g.latest.data.fields.vout.value_v)+' V':'当前修订尚无测量依据'}</p>${B('查看并指导','group:'+g.id,'link')}</div>`).join(''):`<div class="empty">${I('check')}<p>等待学生开始实验<br>新的求助和测量会出现在这里。</p></div>`}</section></div><div class="panelhead"><h2>小组实验</h2><span class="small muted">点击查看原始记录与指导</span></div><div class="group-grid">${gs.map(g=>`<button class="group-card ${g.help?'help':''}" data-action="group:${g.id}"><div class="row"><h3>${E(g.name)}</h3>${P(g.help?'求助中':statusLabels[g.status],g.help?'amber':g.status==='reviewed'?'green':'blue')}</div><p>${g.latest?E(g.latest.data.assessment.label):'等待本修订首次测量'}</p><div class="small">${E(g.members.join('、'))} · 实物修订 ${g.revision}</div></button>`).join('')}</div>`;
}
function progressBars(gs){return `<div class="barlist">${[['working','进行中','#80a9f5'],['submitted','待复核','#5089ed'],['returned','待补充','#dfae66'],['reviewed','已反馈','#69b397']].map(([s,l,c])=>{const n=gs.filter(g=>g.status===s).length;return `<div><div class="bar-label"><span>${l}</span><span class="num">${n} 组</span></div><div class="bar-track"><div class="bar-fill" style="width:${gs.length?n/gs.length*100:0}%;background:${c}"></div></div></div>`}).join('')}</div>`}

function measurementChart(g){
  const rows=g.events.filter(e=>e.kind==='measurement'),latest=g.latest;
  let content='';
  if(!rows.length)content=`<div class="empty">${I('chart')}<p>确认第一条测量后，曲线会从这里开始。</p></div>`;
  else{
    // Every recorded measurement has an x position; missing/invalid values are gaps, never zero.
    const W=640,H=250,L=49,R=20,T=20,D=40, valid=rows.filter(e=>e.data.fields.vout.value_v!=null&&Math.abs(e.data.fields.vout.value_v)<=5);
    const max=Math.max(2,...valid.map(e=>e.data.fields.vout.value_v),...rows.map(e=>e.data.assessment.expected_v||0))+.15;
    const min=Math.min(0,...valid.map(e=>e.data.fields.vout.value_v))-.05;
    const x=i=>rows.length===1?(W+L-R)/2:L+i*(W-L-R)/(rows.length-1), y=v=>H-D-(v-min)/(max-min)*(H-T-D);
    const ticks=Array.from({length:5},(_,i)=>min+(max-min)*i/4);
    let lines='',expect='',bands='',points='',breaks='';
    for(let i=0;i<rows.length;i++){
      const e=rows[i],v=e.data.fields.vout.value_v,a=e.data.assessment,px=x(i),good=v!=null&&Math.abs(v)<=5;
      if(i&&e.revision!==rows[i-1].revision)breaks+=`<line x1="${(px+x(i-1))/2}" y1="12" x2="${(px+x(i-1))/2}" y2="${H-D}" stroke="#c9d6e8" stroke-dasharray="3 4"/>`;
      if(i&&e.revision===rows[i-1].revision){const prev=rows[i-1],pv=prev.data.fields.vout.value_v,pa=prev.data.assessment;
        if(good&&pv!=null&&Math.abs(pv)<=5)lines+=`<path d="M${x(i-1)} ${y(pv)}L${px} ${y(v)}" fill="none" stroke="#2868e8" stroke-width="2.5"/>`;
        if(a.expected_v!=null&&pa.expected_v!=null){expect+=`<path d="M${x(i-1)} ${y(pa.expected_v)}L${px} ${y(a.expected_v)}" fill="none" stroke="#91a7c5" stroke-width="1.5" stroke-dasharray="5 4"/>`;bands+=`<polygon points="${x(i-1)},${y(pa.expected_v+.05)} ${px},${y(a.expected_v+.05)} ${px},${y(a.expected_v-.05)} ${x(i-1)},${y(pa.expected_v-.05)}" fill="#e8f0ff"/>`}
      }
      if(a.expected_v!=null)expect+=`<line x1="${px-9}" y1="${y(a.expected_v)}" x2="${px+9}" y2="${y(a.expected_v)}" stroke="#91a7c5" stroke-width="1.5"/>`;
      if(good)points+=`<circle cx="${px}" cy="${y(v)}" r="4.5" fill="${e.revision===g.revision?'#2868e8':'#97afd3'}" stroke="white" stroke-width="2"><title>测量 ${i+1}：${fmt(v)} V，修订 ${e.revision}</title></circle>`;
      if(rows.length<=12||i===0||i===rows.length-1)points+=`<text x="${px}" y="${H-14}" text-anchor="middle" fill="#7687a0" font-size="12">${i+1}</text>`;
    }
    content=`<div class="chartwrap"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="输出电压测量曲线，横轴为测量序号，纵轴单位伏。修改前后曲线不连接。"><text x="8" y="14" fill="#7687a0" font-size="12">V</text>${ticks.map(v=>`<line x1="${L}" y1="${y(v)}" x2="${W-R}" y2="${y(v)}" stroke="#edf1f7"/><text x="${L-10}" y="${y(v)+4}" text-anchor="end" fill="#7687a0" font-size="12">${v.toFixed(1)}</text>`).join('')}${bands}${breaks}${expect}${lines}${points}</svg></div><div class="legend"><span>实测输出</span><span class="expected">按实测供电计算的预期</span><span class="band">±0.05 V</span></div><p class="chart-note">横轴：测量序号。改线前后不连线；未测、OL 或超出 ±5 V 的可疑值留空，原值保留在记录中。</p>`;
  }
  const f=latest?.data.fields,a=latest?.data.assessment;
  return `<section class="panel"><div class="panelhead"><h2>输出与预期</h2>${P(a?a.label:'等待测量',a?.code==='pass'?'green':a?'amber':'')}</div>${content}<div class="reading-stats"><div><span class="name">供电实测</span><strong>${fmt(f?.vin.value_v)}<small>V</small></strong></div><div><span class="name">输出实测</span><strong>${fmt(f?.vout.value_v)}<small>V</small></strong></div><div><span class="name">预期输出</span><strong>${fmt(a?.expected_v)}<small>V</small></strong></div></div><p class="chart-note">上方数值仅取实物修订 ${g.revision} 的最新测量。${latest?'判定依据：'+latest.id.slice(0,8):'改线后需重新测量供电和输出。'}</p></section>`;
}

function studentLab(){const g=current(),teacher=g.events.filter(e=>e.kind==='message'||e.kind==='review').at(-1);return `${heading('电阻分压实验',g.name+' · '+g.members.join('、')+' · 实物修订 '+g.revision,B('实验说明','instructions','btn','book'))}<div class="student-layout"><div class="stack">${measurementChart(g)}<section class="panel"><div class="panelhead"><h2>实验进程</h2>${P(statusLabels[g.status],'blue')}</div><p class="small muted">${E(S.data.course.experiment.safety)}</p><div class="actions" style="margin-top:17px">${B('记录改线 / 换件','revision','btn','refresh',locked(g)?'disabled':'')}${B(g.help?'已发出求助':'向教师求助','help','link','help')}</div></section>${teacher?`<section class="panel"><div class="panelhead"><h2>${teacher.kind==='review'?'教师反馈':'教师指导'}</h2><span class="small muted">${timeOnly(teacher.created)}</span></div><div class="bubble teacher">${E(teacher.data.text)}</div><p class="chart-note">${E(teacher.author)} · 已保存到本组记录</p></section>`:''}</div><div class="stack"><section class="panel"><div class="panelhead"><h2>把实验发现告诉助教</h2>${P('先核对，再记录','blue')}</div><p class="small muted" style="margin-bottom:16px">输入读数、检查发现或实验问题，助教帮你整理。</p>${locked(g)?`<div class="notice">${g.status==='submitted'?'结论已提交，等待教师复核。':'教师已反馈，请查看实验结论。'}如需补充，请联系教师退回。</div>`:`<div class="composer"><label class="sr-only" for="raw">描述测量或检查发现</label><textarea id="raw" maxlength="2000" placeholder="例如：供电 3.30 V，输出 80 mV，黑表笔接 TP0。">${E(S.raw)}</textarea><div class="composer-foot"><span class="small">${S.online?'单位与原话一并保留':'离线文字保存在此设备'}</span>${B(S.online?'整理这段记录':'暂存文字','extract','primary','spark')}</div></div><div class="suggestions">${B('试填测量','example','btn')}${B('添加实验照片','photo','btn','camera')}${B('提问与指导','student-assist','btn','chat')}</div>`}${pendingTexts(g)}${S.draft?draftCard():''}</section>${S.assist?assistCard(false):`<section class="ai-panel"><div class="ai-title"><span class="ai-icon">${I('spark')}</span><h2>下一步，为什么这样做？</h2></div><p>确认测量后，可以让助教根据本组记录提出检查建议。数值判断由实验规则完成，原因需要你用证据区分。</p>${B('根据记录给我提示','student-assist','link')}</section>`}</div></div>`}
function pendingTexts(g){const list=S.pending.filter(p=>p.group===g.id);if(!list.length)return '';return `<div class="notice amber"><strong>${list.length} 段文字暂存在本机</strong>${list.map(p=>`<div class="evidence-item"><p>${E(p.text)}</p><div class="small">输入时修订 ${p.revision}${p.revision!==g.revision?' · 接线已变化，请先核对':''}</div><div class="actions">${B('载入并重新提取','pending:'+p.id,'link')}${B('删除暂存','discard:'+p.id,'link')}</div></div>`).join('')}</div>`}
function draftCard(){const d=S.draft;return `<section class="draft" aria-label="待确认提取结果"><div class="panelhead"><h3>请核对这条记录</h3>${P('尚未计入测量')}</div><p class="raw">${E(d.raw)}</p><p class="chart-note">${E(d.source)} · 修订 ${d.revision}</p>${d.requires_revision?`<div class="notice amber">这段文字描述了实物修改。请先记录改线或换件，开启新修订，再单独输入复测读数。${B('先记录实物修改','revision','link')}</div>`:''}${d.kind==='measurement'?`<hr class="divider"><div class="extract-fields">${[['vin','供电'],['vout','输出']].map(([f,l])=>`<div class="field"><label for="edit-${f}">${l}读数</label><div class="quantity"><input id="edit-${f}" type="text" inputmode="decimal" aria-label="${l}读数" value="${E(d[f].raw)}" placeholder="未测可留空"><select id="unit-${f}" aria-label="${l}单位"><option ${d[f].unit==='V'?'selected':''}>V</option><option ${d[f].unit==='mV'?'selected':''}>mV</option></select></div></div>`).join('')}</div><div class="field"><label for="reference">本次测量参考点 / 黑表笔</label><select id="reference">${[['unknown','尚未确认'],['TP0','TP0 · 参考地'],['TP1','TP1 · 供电'],['TP2','TP2 · 输出']].map(([v,l])=>`<option value="${v}" ${d.reference===v?'selected':''}>${l}</option>`).join('')}</select></div>${d.ambiguities.length?`<div class="notice amber">${d.ambiguities.map(E).join('<br>')}</div>`:''}<label class="check"><input type="checkbox" id="acknowledged" ${d.acknowledged?'checked':''}><span>如有负数、单位歧义或参考点待确认，我已核对，按当前读数保留并标记待查。</span></label><p class="chart-note">空白与 OL 都不会按 0 处理。任何修正均保留最初提取结果。</p>`:`<div class="notice">将作为观察 / 提问保存，不自动生成测量数值。${d.suggest_revision?'文字中提到实物修改，请先记录改线或换件，建立新修订后再复测。':''}</div>`}<div class="actions" style="margin-top:17px">${B('核对无误，记入实验','confirm','primary','check',d.requires_revision?'disabled':'')}${B('取消草稿','cancel-draft','link')}</div></section>`}
function timeOnly(value){return new Date(value).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit',timeZone:'Asia/Shanghai'})}
function timeline(g){return g.events.length?`<div class="timeline">${g.events.slice().reverse().map(e=>`<article class="event" id="event-${e.id}" tabindex="-1"><time datetime="${e.created}">${new Date(e.created).toLocaleDateString('zh-CN',{month:'2-digit',day:'2-digit',timeZone:'Asia/Shanghai'})}<br>${timeOnly(e.created)}</time><div class="event-body"><div class="event-title"><strong>${E(titleByKind[e.kind])}</strong>${P('修订 '+e.revision,e.revision===g.revision?'blue':'')}</div>${eventBody(e)}<div class="event-detail">${E(e.author)} · 记录 ${e.id.slice(0,8)}</div></div></article>`).join('')}</div>`:`<div class="empty">${I('clock')}<p>实验记录将按时间保存在这里。</p></div>`}
function eventBody(e){const d=e.data;if(e.kind==='measurement'){const f=d.fields,a=d.assessment;return `<p class="raw">${E(d.raw)}</p><div class="event-detail">确认值：供电 ${E(f.vin.raw||'未测')} ${E(f.vin.unit)} · 输出 ${E(f.vout.raw||'未测')} ${E(f.vout.unit)}<br>参考点：${E(f.reference)} · ${E(a.label)}</div>${a.expected_v!=null?`<div class="event-detail">预期 ${fmt(a.expected_v)} V · 实测偏差 ${fmt(a.deviation_v)} V · 容许偏差 ±0.05 V（含边界）</div>`:''}${a.warnings.length?`<div class="notice amber">${a.warnings.map(E).join('<br>')}</div>`:''}<details><summary>查看最初提取与修正</summary><p>初次提取：供电 ${E(d.extracted.vin.raw||'未识别')} ${E(d.extracted.vin.unit)}，输出 ${E(d.extracted.vout.raw||'未识别')} ${E(d.extracted.vout.unit)}，参考点 ${E(d.extracted.reference)}。</p><p>${d.manually_corrected?'确认前有人工修正。':'确认值与最初提取一致。'}计算使用换算后的 V 值，原始读数与单位分别保存。</p></details>`}if(e.kind==='photo')return `${d.caption?`<p class="raw">${E(d.caption)}</p>`:''}<a href="/api/photos/${E(d.file)}" target="_blank" rel="noopener"><img class="photo" src="/api/photos/${E(d.file)}" alt="${E(d.caption||'学生上传的实验照片')}"></a><p class="chart-note">照片证据 · 尚未进行图像识别</p>`;return `<p class="raw">${E(d.raw||d.text||d.reason||d.conclusion)}</p>${e.kind==='submission'?`<div class="event-detail">关联 ${d.evidence.length} 条证据 · 提交时冻结引用</div>`:''}${e.kind==='review'?`<div class="event-detail">${d.decision==='return'?'退回补充':'已反馈'} · 关联提交 ${d.submission_id.slice(0,8)}</div>`:''}`}
function studentRecords(){const g=current();return `${heading('实验过程记录','原话、确认值、修改与教师指导都在这里。')}${measurementChart(g)}<section class="panel" style="margin-top:20px"><div class="panelhead"><h2>证据时间线</h2>${P(g.events.length+' 条记录')}</div>${timeline(g)}</section>`}
function studentSubmit(){const g=current(),sub=lastSubmission(g),review=g.events.filter(e=>e.kind==='review').at(-1);return `${heading('用证据，解释你的发现',g.name+' · 实物修订 '+g.revision)}<div class="twocol"><section class="panel"><div class="panelhead"><h2>实验结论</h2>${P(statusLabels[g.status],'blue')}</div>${review?`<div class="bubble teacher"><div class="bubblehead">${I('book')}教师反馈 · ${review.data.decision==='return'?'请补充后重新提交':'已复核'}</div>${E(review.data.text)}</div><hr class="divider">`:''}<div class="field"><label for="conclusion">请用自己的话说明</label><textarea id="conclusion" maxlength="3000" style="min-height:230px" ${locked(g)?'readonly':''} placeholder="预期输出是多少？依据哪些测量？检查或修改了什么？复测能支持什么结论？">${E(locked(g)?sub?.data.conclusion:S.conclusion||sub?.data.conclusion||'')}</textarea></div><p class="chart-note">提交会关联当前修订的证据。AI 提示可供参考，原理和结论由你解释。</p>${!locked(g)?`<div style="margin-top:18px">${B('核对并提交给教师','submit','primary','check')}</div>`:''}</section><div class="stack">${measurementChart(g)}<section class="panel"><h2>当前关联依据</h2><div class="notice">修订 ${g.revision} · ${g.events.filter(e=>e.revision===g.revision&&e.kind==='measurement').length} 次测量 · ${g.events.filter(e=>e.revision===g.revision&&e.kind==='photo').length} 张照片</div>${B('查看原始过程','view:records','link')}</section></div></div>`}

function groupView(){const g=current(),sub=lastSubmission(g);return `${B('返回课堂','view:overview','link','back')}<div style="margin-top:14px">${heading(g.name+' · 实验过程',g.members.join('、')+' · 实物修订 '+g.revision,B('起草本组指导','group-assist','primary','spark'))}</div><div class="twocol"><div class="stack">${measurementChart(g)}${sub?`<section class="panel"><div class="panelhead"><h2>学生实验结论</h2>${P(statusLabels[g.status],'blue')}</div><div class="conclusion">${E(sub.data.conclusion)}</div><p class="chart-note">提交 ${sub.id.slice(0,8)} · 修订 ${sub.revision} · 关联 ${sub.data.evidence.length} 条证据</p></section>`:''}<section class="panel"><div class="panelhead"><h2>过程时间线</h2>${P(g.events.length+' 条')}</div>${timeline(g)}</section></div><div class="stack"><section class="panel"><div class="panelhead"><h2>给本组的指导</h2>${g.help?P('主动求助','amber'):P('教师确认后发送')}</div><div class="field"><label for="message">指导内容</label><textarea id="message" maxlength="3000" placeholder="描述下一步检查，可以让助教先起草。">${E(S.message)}</textarea></div>${B('确认并发送给 '+g.name,'send-message','primary','send')}${S.assist?`<p class="chart-note">${E(S.assist.notice)}</p>${sources(S.assist)}`:''}</section>${g.status==='submitted'?`<section class="panel"><h2 style="margin-bottom:15px">复核实验结论</h2><div class="field"><label for="feedback">教师反馈</label><textarea id="feedback" maxlength="3000" placeholder="指出已有证据和需要补充的解释。">${E(S.feedback)}</textarea></div><div class="actions">${B('确认并反馈','review:feedback','primary','check')}${B('退回补充','review:return','btn')}</div><p class="chart-note">本版不自动生成最终成绩。</p></section>`:''}<section class="ai-panel"><div class="ai-title"><span class="ai-icon">${I('spark')}</span><h2>依据与边界</h2></div><p>建议只使用本组已保存记录和实验判据。单次输出偏差不能唯一确定故障原因。</p><p>改线后开启新修订，当前判定等待重新测量。</p></section></div></div>`}
function reports(){const gs=S.data.groups.filter(g=>lastSubmission(g));return `${heading('实验提交','核对学生解释和原始依据，反馈由教师确认。')}<section class="panel"><table class="report-table"><caption>电阻分压实验</caption><thead><tr><th>小组</th><th>状态</th><th class="desktop-only">关联依据</th><th>操作</th></tr></thead><tbody>${gs.map(g=>`<tr><td>${E(g.name)}</td><td>${P(statusLabels[g.status],g.status==='reviewed'?'green':'blue')}</td><td class="desktop-only">修订 ${lastSubmission(g).revision} · ${lastSubmission(g).data.evidence.length} 条证据</td><td>${B('查看复核','group:'+g.id,'link')}</td></tr>`).join('')}</tbody></table>${!gs.length?`<div class="empty">${I('file')}<p>还没有实验提交。学生提交后会出现在这里。</p></div>`:''}</section>`}
function sources(answer){return `<div class="sources">${answer.evidence.slice(-12).map(e=>`<button data-action="source:${e.id}" title="查看原始记录">${E(e.group)} · ${E(titleByKind[e.kind]||e.kind)} ${e.id.slice(0,8)}</button>`).join('')}</div>`}
function assistCard(editable){return `<section class="panel ai-answer"><div class="panelhead"><h2>${S.assist.mode==='model'?'AI 建议草稿':'实验规则建议'}</h2>${P('待核对','blue')}</div><p class="small muted" style="margin-bottom:13px">${E(S.assist.notice)}</p>${editable?`<label for="assist-text">可编辑的教学草稿</label><textarea id="assist-text" maxlength="8000">${E(S.assist.text)}</textarea>`:`<div class="bubble">${E(S.assist.text)}</div>`}${sources(S.assist)}${editable?`<p class="chart-note">选择具体小组生成后，可放入该组指导框，核对后发送。</p>${S.assistTarget?B('放入本组指导框','use-assist','link'):''}`:''}</section>`}
function assistPage(){return `<div class="assist-page">${heading('AI 教学助教','描述教学任务，让助教先整理一份有依据的草稿。')}<section class="ai-panel"><div class="ai-title"><span class="ai-icon">${I('spark')}</span><h2>把时间留给需要你的学生</h2></div><p>梳理课堂情况、起草分组指导、准备反馈与共性讲解。所有发送和复核由你确认。</p><div class="suggestions">${B('课堂小结','prompt:summary','btn')}${B('排查指导','prompt:guidance','btn')}${B('反馈建议','prompt:feedback','btn')}</div></section><section class="panel"><div class="field"><label for="assist-target">使用哪些记录</label><select id="assist-target"><option value="">本次课堂 · 全部小组</option>${S.data.groups.map(g=>`<option value="${g.id}" ${S.assistTarget===g.id?'selected':''}>${E(g.name)} · 本组记录</option>`).join('')}</select></div><div class="field"><label for="question">您希望助教做什么</label><textarea id="question" maxlength="1500" placeholder="例如：给输出偏低的小组准备补测指导，并列出已有依据。">${E(S.question)}</textarea></div>${B('生成可编辑草稿','assist','primary','spark')}</section>${S.assist?`<div style="margin-top:20px">${assistCard(true)}</div>`:''}</div>`}
function experimentPage(){const e=S.data.course.experiment;return `${heading('实验模板','教师与学生共用同一份目标、测点和判据。')}<section class="panel"><div class="panelhead"><h2>${E(e.title)}</h2>${P('实验包 v'+e.version,'blue')}</div><p class="muted">${E(e.objective)}</p><div class="experiment-points">${Object.entries(e.points).map(([k,v])=>`<div class="point"><strong>${k}</strong><span class="small">${E(v)}</span></div>`).join('')}</div><p>R1 = R2 = 10 kΩ（±1%） · 3.3 V 低压直流</p><div class="notice"><strong>${E(e.formula)}</strong><br>供电实测 3.20–3.40 V、参考点确认为 TP0 时，输出与实测供电一半的偏差 ≤ 0.050 V（含边界），判为符合数值判据。</div><div class="steps">${e.steps.map((s,i)=>`<div class="step"><span>步骤 ${i+1}</span>${E(s)}</div>`).join('')}</div><div class="notice amber">${E(e.safety)}</div><p class="chart-note">本版实验包只读。物理、化学、生物实验包后续分别定义量、单位、规则和安全约束。</p></section>`}
function dialog(){let title='',body='';if(S.modal==='instructions'){title='电阻分压实验';body=`<p>两只 10 kΩ 电阻串联，供电约 3.3 V。先预测 TP2 对 TP0 的电压，再通过测量验证。</p><div class="notice">TP1：供电 · TP2：输出 · TP0：参考地<br>供电范围 3.20–3.40 V；输出容许偏差 ±0.050 V。</div><div class="notice amber">${E(S.data.course.experiment.safety)}</div><div style="margin-top:20px">${B('开始实验','close','primary wide')}</div>`}if(S.modal==='revision'){title='记录实物修改';body=`<p>改线或换件后建立新修订，旧测量留在过程记录。新修订需要重新测量供电和输出。</p><div class="notice amber" style="margin-bottom:17px">请先断电，再改线、换件或测电阻。</div><label for="revision-reason">这次修改了什么</label><textarea id="revision-reason" maxlength="1000" placeholder="例如：断电后重新连接 R2 下端到 TP0。">${E(S.revisionReason)}</textarea><div style="margin-top:18px">${B('确认修改，开启新修订','save-revision','primary wide')}</div>`}if(S.modal==='help'){title='向教师求助';body=`<p>说明已经检查的内容，教师可以直接看到本组过程记录。</p><label for="help-text">需要什么帮助</label><textarea id="help-text" maxlength="1000" placeholder="例如：参考点和供电已核对，输出仍偏低，不知道下一步测哪里。">${E(S.helpText)}</textarea><div style="margin-top:18px">${B('确认发送求助','save-help','primary wide')}</div>`}if(S.modal==='photo'){title='添加实验照片';body=`<p>支持 JPEG、PNG，最大 4 MB。照片作为原始证据保存，本版不进行图像识别。</p><div class="field"><label for="photo-file">选择照片</label><input id="photo-file" type="file" accept="image/jpeg,image/png"></div><label for="photo-caption">照片说明（可选）</label><input id="photo-caption" maxlength="300" value="${E(S.photoCaption)}" placeholder="例如：本次复测前的接线和表笔位置"><div style="margin-top:18px">${B('保存到本组记录','save-photo','primary wide')}</div>`}return `<div class="overlay"><section class="dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title"><div class="panelhead"><h2 id="dialog-title">${title}</h2><button class="close" data-action="close" aria-label="关闭">${I('close')}</button></div>${body}${S.error?`<div class="error" role="alert">${E(S.error)}</div>`:''}</section></div>`}

async function getAssist(question,gid){
  toast('正在根据已保存的记录整理建议…');
  const answer=await api('/assist',{question,group_id:gid||undefined});S.assist=answer;return answer;
}
async function extractText(){
  if(!S.raw.trim())throw new Error('请先输入一段测量或检查描述');
  if(!S.online){stashText();return}
  try{S.draft=await api('/groups/'+current().id+'/extract',command({text:S.raw,revision:current().revision}));S.raw=''}
  catch(e){if(e.network){S.online=false;stashText()}else throw e}
}
async function action(name){
  const [a,v]=name.split(':');
  if(a==='login-role'){S.loginRole=v;S.loginUser=v==='teacher'?'teacher':'student1';S.error='';return}
  if(a==='logout'){await api('/logout',{});S.data=null;S.draft=null;S.raw='';S.assist=null;S.pending=[];S.error='';S.message='';S.feedback='';S.conclusion='';S.modal=null;return}
  if(a==='view'){S.view=v;S.error='';S.assist=null;return}
  if(a==='group'){S.gid=v;S.view='group';S.message='';S.feedback='';S.assist=null;return}
  if(a==='close'){S.modal=null;S.error='';return}
  if(['instructions','revision','help','photo'].includes(a)){S.modal=a;S.error='';return}
  if(a==='example'){S.raw='供电 3.30 V，输出 80 mV，黑表笔接 TP0。';return}
  if(a==='cancel-draft'){S.draft=null;return}
  if(a==='extract'){await extractText();return}
  if(a==='confirm'){
    const d=S.draft;if(!d)return;
    const payload=command({draft_id:d.id,revision:d.revision,vin:d.vin,vout:d.vout,reference:d.reference,acknowledged:!!d.acknowledged});
    await api('/groups/'+current().id+'/records',payload);S.draft=null;toast('记录已保存，师生两端共享同一份依据');await refresh(false);return;
  }
  if(a==='pending'){const p=S.pending.find(p=>p.id===v);S.raw=p.text;S.pending=S.pending.filter(x=>x.id!==v);persistPending();return}
  if(a==='discard'){S.pending=S.pending.filter(x=>x.id!==v);persistPending();return}
  if(a==='save-revision'){await api('/groups/'+current().id+'/revision',command({revision:current().revision,reason:$('#revision-reason').value}));S.draft=null;S.assist=null;S.modal=null;S.revisionReason='';await refresh(false);toast('已开启新修订，请重新测量供电和输出');return}
  if(a==='save-help'){await api('/groups/'+current().id+'/help',command({text:$('#help-text').value}));S.modal=null;S.helpText='';await refresh(false);toast('求助已保存，教师端可见');return}
  if(a==='save-photo'){
    const file=$('#photo-file').files[0];if(!file)throw new Error('请先选择照片');if(file.size>4*1024*1024)throw new Error('照片不能超过 4 MB');
    const content=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result.split(',')[1]);r.onerror=reject;r.readAsDataURL(file)});
    await api('/groups/'+current().id+'/photo',command({revision:current().revision,content,caption:$('#photo-caption').value}));S.modal=null;S.photoCaption='';await refresh(false);toast('照片已保存');return;
  }
  if(a==='submit'){await api('/groups/'+current().id+'/submit',command({revision:current().revision,conclusion:S.conclusion}));await refresh(false);toast('实验结论已提交，等待教师复核');return}
  if(a==='send-message'){await api('/groups/'+current().id+'/message',command({text:S.message}));S.message='';await refresh(false);toast('指导已保存到本组，学生端刷新后可见');return}
  if(a==='review'){await api('/groups/'+current().id+'/review',command({decision:v,text:S.feedback,submission_id:lastSubmission(current()).id}));S.feedback='';await refresh(false);toast(v==='return'?'已退回补充，反馈已保存':'教师反馈已保存');return}
  if(a==='student-assist'){if(S.raw.trim())S.question=S.raw;await getAssist(S.raw.trim()||'请根据我的当前实验记录，给我下一步检查提示。',current().id);return}
  if(a==='group-assist'){const answer=await getAssist('请为本组起草简短的实验指导，指出已有依据、缺失证据和下一步可区分原因的检查。',current().id);S.message=answer.text;return}
  if(a==='class-summary'){S.view='assist';S.question='请根据本次课堂记录起草课后小结，区分已记录情况与待核对问题，并给出下一课的教学建议。';S.assistTarget='';await getAssist(S.question,null);return}
  if(a==='prompt'){S.question={summary:'请整理本次课堂小结，列出已有依据与待核对问题。',guidance:'请根据测量和求助记录，准备分组排查提示，避免直接确定故障。',feedback:'请根据实验提交与测量记录，起草教师反馈，指出还需要学生解释的地方。'}[v];return}
  if(a==='assist'){await getAssist(S.question,S.assistTarget);return}
  if(a==='use-assist'){if(!S.assistTarget)throw new Error('请先选择一个具体小组');S.gid=S.assistTarget;S.message=S.assist.text;S.view='group';return}
  if(a==='source'){
    const g=S.data.groups.find(g=>g.events.some(e=>e.id===v));if(!g)return;
    S.gid=g.id;S.view=isTeacher()?'group':'records';render();setTimeout(()=>{const el=$('#event-'+v);el?.scrollIntoView({behavior:'smooth',block:'center'});el?.classList.add('flash');el?.focus({preventScroll:true})},100);return;
  }
}
root.addEventListener('click',async event=>{
  const button=event.target.closest('[data-action]');if(!button||S.busy)return;
  capture();const name=button.dataset.action;S.error='';S.busy=true;
  // Keep the current dialog and file input mounted while its asynchronous action reads them.
  root.querySelectorAll('button').forEach(b=>b.disabled=true);
  try{await action(name)}catch(e){S.error=e.network?'连接失败，原输入仍保留，请恢复连接后重试。':e.message;if(e.status===401){S.data=null;S.modal=null}if(e.status===409&&S.data)await refresh(false).catch(()=>{})}
  finally{S.busy=false;render()}
});
root.addEventListener('submit',async event=>{
  if(event.target.id!=='login-form')return;event.preventDefault();if(S.busy)return;capture();S.busy=true;S.error='';render();
  try{await api('/login',{username:S.loginUser,password:S.loginPassword});await refresh(false);S.view=isTeacher()?'overview':'lab';S.pending=JSON.parse(localStorage.getItem(key('pending'))||'[]');S.gid=S.data.groups[0].id}
  catch(e){S.error=e.network?'暂时无法连接服务，请稍后重试。':e.message}finally{S.busy=false;render()}
});
root.addEventListener('input',capture);
document.addEventListener('keydown',e=>{
  if(e.key==='Escape'&&S.modal&&!S.busy){S.modal=null;S.error='';render()}
  if(e.key==='Tab'&&S.modal){
    const items=[...document.querySelectorAll('.dialog button:not([disabled]),.dialog input,.dialog textarea,.dialog select')];
    const first=items[0],last=items.at(-1);
    if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus()}
    else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus()}
  }
});
window.addEventListener('offline',()=>{capture();S.online=false;render()});
window.addEventListener('online',()=>{if(S.data)refresh().catch(()=>{S.online=false;render()})});
setInterval(async()=>{if(!S.data||S.busy||S.modal)return;try{await refresh(false)}catch(e){if(e.status===401){S.data=null;render()}else if(S.online){capture();S.online=false;render()}}},6000);
(async()=>{try{await refresh(false);S.view=isTeacher()?'overview':'lab';S.pending=JSON.parse(localStorage.getItem(key('pending'))||'[]')}catch(e){if(e.status!==401)S.error='服务暂不可用，请稍后刷新。'}render()})();
