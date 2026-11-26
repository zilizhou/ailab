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
const locked = g => ['submitted','reviewed'].includes(g.status)||(typeof teachingBlock==='function'&&!!teachingBlock(g));
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
  if(typeof teachingCapture==='function')teachingCapture();
  const fields={raw:'#raw',conclusion:'#conclusion',message:'#message',feedback:'#feedback',question:'#question',assistTarget:'#assist-target',loginUser:'#username',loginPassword:'#password',revisionReason:'#revision-reason',helpText:'#help-text',photoCaption:'#photo-caption'};
  for(const [name,selector] of Object.entries(fields)){const el=$(selector);if(el)S[name]=el.value}
  if(S.draft){for(const f of ['vin','vout']){const el=$('#edit-'+f);if(el){S.draft[f].raw=el.value;S.draft[f].unit=$('#unit-'+f).value}}if($('#reference'))S.draft.reference=$('#reference').value;S.draft.acknowledged=!!$('#acknowledged')?.checked}
  if(S.assist&&$('#assist-text'))S.assist.text=$('#assist-text').value;
}
let refreshGeneration=0;
async function refresh(renderNow=true){
  const generation=++refreshGeneration;
  const wasOnline=S.online;
  const before=JSON.stringify(S.data);
  const catalogBefore=typeof T!=='undefined'?JSON.stringify(T.catalog):null;
  let data;
  try{
    const scope=typeof teachingLoad==='function'?await teachingLoad(()=>generation===refreshGeneration):'/state';
    if(generation!==refreshGeneration)return;
    data=await api(scope);
  }catch(error){if(generation!==refreshGeneration)return;throw error}
  if(generation!==refreshGeneration)return;
  // Server clock alone does not trigger a render.
  delete data.server_time;
  S.data=data;S.online=true;
  if(!S.gid||!data.groups.some(g=>g.id===S.gid))S.gid=data.groups[0]?.id;
  if(S.draft&&S.draft.revision!==current()?.revision){S.draft=null;S.error='实物修订已更新，旧草稿已撤下。请按当前接线重新测量。'}
  if(S.busy)return;
  if(renderNow||before!==JSON.stringify(data)||(typeof T!=='undefined'&&catalogBefore!==JSON.stringify(T.catalog))||!wasOnline||S.renderPending){
    if(renderNow||!document.activeElement?.matches('textarea,input,select')){capture();render()}
    else S.renderPending=true;
  }
}
function approvedMarkup(html){
  const aliases={btn:'x-btn',primary:'x-primary',link:'x-link',wide:'x-wide',pill:'x-pill',row:'x-row',actions:'x-actions',panel:'x-panel',panelhead:'x-panelhead',small:'x-small',muted:'x-muted',heading:'x-heading',field:'x-field','extract-fields':'x-fields',composer:'x-composer','composer-foot':'x-composerfoot',suggestions:'x-suggestions','ai-panel':'x-ai','ai-title':'x-aihead','ai-icon':'x-aiicon',twocol:'x-twocol',priority:'x-priority','group-grid':'x-groups','group-card':'x-group','chart-note':'x-chartnote',error:'x-error',notice:'x-notice',dialog:'x-dialog',overlay:'x-overlay',close:'x-close','report-table':'x-table','desktop-only':'x-hidephone'};
  return html.replace(/class="([^"]*)"/g,(_,value)=>{const names=value.split(/\s+/).filter(Boolean);return 'class="'+[...new Set([...names,...names.map(n=>aliases[n]).filter(Boolean)])].join(' ')+'"'});
}
function render(){
  S.renderPending=false;
  root.innerHTML='<div id="lab-v2">'+approvedMarkup((S.data?shell():login())+(S.modal?dialog():''))+'</div>';
  if(S.modal)setTimeout(()=>$('.dialog input,.dialog textarea,.dialog button')?.focus(),0);
}
function login(){if(typeof T!=='undefined'&&T.authMode==='register')return teachingRegisterView();return `<main class="auth-stage"><section class="auth-shell"><header class="x-head"><div class="x-brand"><span class="x-mark">${I('circuit')}</span>验知有道</div>${P('教学试用版','blue')}</header><form id="login-form" class="auth-form"><h1>进入实验教学空间</h1><p class="muted auth-intro">以实验记录为依据，连接每一次教与学。</p><div class="x-previewtabs auth-roles" aria-label="选择试用账号">${['student','teacher'].map(r=>`<button type="button" aria-pressed="${S.loginRole===r}" data-action="login-role:${r}">${I(r==='student'?'user':'book')}${r==='student'?'学生端':'教师端'}</button>`).join('')}</div><div class="field"><label for="username">账号</label><input id="username" autocomplete="username" required value="${E(S.loginUser)}"></div><div class="field"><label for="password">密码</label><input id="password" type="password" autocomplete="current-password" required value="${E(S.loginPassword)}"></div>${S.error?`<div class="error" role="alert">${E(S.error)}</div>`:''}<button class="primary wide" type="submit" ${S.busy?'disabled':''}>${S.busy?'正在登录…':S.loginRole==='teacher'?'进入教师工作台':'进入学生实验'}</button><p class="auth-demo">试用账号：teacher、student1、student2<br>密码：Lab2026! · 学生账号分别属于两个小组</p>${B('学生注册','register-open','link')}</form></section></main>`}
function header(){return `<header class="x-head"><div class="x-brand"><span class="x-mark">${I('circuit')}</span>实验助教<span class="x-headnote">教师工作台</span></div><div class="actions"><span class="small muted x-headcourse">电子电路基础</span><span class="x-avatar">${E(S.data.user.name[0])}</span>${B('退出','logout','link')}</div></header>`}
function shell(){
  if(typeof T!=='undefined'&&T.catalog)return teachingShell();
  const error=S.error?`<div class="error" role="alert">${E(S.error)}</div>`:'';
  if(isTeacher())return `<div class="teacher-stage"><div class="x-shell">${header()}<div class="x-layout">${sidebar()}<main class="x-main">${teacherView()}${error}<footer class="sync-foot">${connection()}</footer></main></div></div></div>`;
  const g=current();
  return `<div class="x-stage student-stage"><div class="x-phone"><header class="x-phonehead"><div class="row"><div class="x-brand"><span class="x-mark">${I('circuit')}</span>实验助教</div><div class="actions"><span class="x-avatar">${E(S.data.user.name[0])}</span>${B('退出','logout','link')}</div></div><div class="x-subline" style="margin:10px 0 0"><span>电子电路基础 · ${E(g?.name||S.data.user.name)}</span><span class="${S.online?'':'offline-text'}">${S.online?'已同步':'连接中断'}</span></div></header><main class="x-phonebody">${studentView()}${error}<div class="student-mode small muted">${S.data.model_configured?'模型建议需核对':'规则助教模式'} · 原话与确认记录分别保留</div></main>${studentNav()}</div></div>`;
}
function connection(){return `<div class="connectionbar"><span class="connection ${S.online?'':'off'}">${S.online?'已连接 · 记录已同步至服务器':'连接中断 · 输入可暂存本机'}</span><span class="muted">教学试用 · ${S.data.model_configured?'模型已配置':'规则助教模式'}</span></div>`}
function sidebar(){return `<aside class="x-side"><span class="x-sidelabel">教学空间</span>${[['overview','课堂总览','grid'],['assist','AI 助教','spark'],['reports','实验提交','file'],['experiment','实验模板','lab']].map(([id,l,i])=>`<button class="${S.view===id||(id==='overview'&&S.view==='group')?'on':''}" data-action="view:${id}">${I(i)}${l}</button>`).join('')}<div class="x-sidefoot">电子电路基础<br>教学试用班<br><br>2026 秋季学期</div></aside>`}
function studentNav(){const active=S.view==='submit'?'lab':S.view;return `<nav class="x-phonenav" aria-label="学生端导航">${[['lab','实验','chat'],['records','记录','chart'],['mine','我的','user']].map(([id,l,i])=>`<button class="${active===id?'on':''}" ${active===id?'aria-current="page"':''} data-action="view:${id}">${I(i)}${l}</button>`).join('')}</nav>`}
function heading(title,description,actions=''){return `<div class="heading"><div><h1>${E(title)}</h1><p>${E(description)}</p></div>${actions}</div>`}
function teacherView(){if(typeof T!=='undefined'&&T.catalog&&teachingViews.includes(S.view))return teachingView();if(S.view==='group'&&!current())return '<div class="empty">请先选择有小组记录的实验任务。</div>';return ({overview:overview,group:groupView,assist:assistPage,reports:reports,experiment:experimentPage}[S.view]||overview)()}
function studentView(){if(S.view==='mine')return studentMine();if(!current())return `<section class="panel empty"><p>选择课程和实验任务，完成分组后开始实验。</p>${B('查看我的课程','view:courses','primary')}</section>`;return ({lab:studentLab,records:studentRecords,submit:studentSubmit}[S.view]||studentLab)()}
function studentMine(){
  const u=S.data.user,g=current(),o=typeof teachingOffering==='function'?teachingOffering():null;
  const c=o?.classes.find(c=>c.id===g?.class_id);
  return `<h1>我的</h1><section class="panel student-profile"><span class="x-avatar">${E(u.name[0])}</span><div><h2>${E(u.name)}</h2><p class="small muted">学生账号 · ${E(u.username||u.id)}</p></div></section><section class="panel"><div class="panelhead"><h2>我的课程</h2>${typeof T!=='undefined'&&T.catalog?B('全部课程','view:courses','link'):''}</div><p>${E(o?.title||S.data.course?.title||'尚未加入课程')}</p>${o?`<p class="small muted">${E(o.term)}${c?' · '+E(c.name):''}</p>`:''}${g?`<div class="student-profile-context"><span class="small muted">当前实验</span><p>${E(S.data.assignment?.title||S.data.course.experiment.title)}</p><div class="actions">${P(statusLabels[g.status],'blue')}${B('返回当前实验','view:lab','link')}</div></div>`:''}</section><section class="panel"><div class="panelhead"><h2>当前实验小组</h2>${g?P(g.members.length+' 人'):''}</div>${g?`<p>${E(g.name)}</p><p class="small muted">${g.members.map(E).join('、')}</p>`:'<p class="muted">选择实验任务并完成分组后，在这里查看同伴。</p>'}</section>${B('退出登录','logout','btn wide')}`;
}

function overview(){
  const gs=S.data.groups,done=gs.filter(g=>['submitted','reviewed'].includes(g.status)).length,help=gs.filter(g=>g.help).length;
  const attention=gs.filter(g=>g.help||g.latest&&g.latest.data.assessment.code!=='pass');
  return `${heading('课堂总览',(S.data.assignment?.title||S.data.course.experiment.title)+' · 本次课堂',B('AI 生成课后小结','class-summary','btn','spark'))}<div class="x-stats">${[[gs.length,'实验小组'],[help,'主动求助'],[done,'已提交']].map(([n,l])=>`<div class="x-stat"><strong>${n}</strong><span>${l}</span></div>`).join('')}</div><section class="ai-panel"><div class="ai-title"><span class="ai-icon">${I('spark')}</span><h2>AI 课堂摘要</h2>${P(S.data.model_configured?'基于已同步记录':'记录摘要 · 规则模式','blue')}</div><p>${help?`${help} 组正在求助。`:''}${attention.length?`${attention.length} 组有待核对的测量或求助。`:'当前没有已记录的异常或求助。'}${done?`已有 ${done} 份实验提交可复核。`:'实验提交后会显示在复核列表。'}</p><p>建议先处理求助，再核对实验结论。未同步或未记录的操作不计为未完成，异常原因仍需证据确认。</p><div class="actions">${B('准备分组指导','prepare-guidance','primary','spark')}${B('生成共性讲解','common','btn')}${B('起草提交反馈','prepare-feedback','link')}</div></section><div class="twocol"><section class="panel"><div class="panelhead"><h2>课堂进展</h2><div class="x-tabs" aria-label="课堂图表">${[['trend','提交趋势'],['stages','阶段分布']].map(([v,l])=>`<button class="${(S.classChart||'trend')===v?'on':''}" data-action="chart:${v}">${l}</button>`).join('')}</div></div>${S.classChart==='stages'?progressBars(gs):submissionTrend(gs)}<p class="chart-note">${S.classChart==='stages'?'按当前状态汇总，每组仅计入一个阶段。':'根据首次提交时间累计去重小组数；退回补充保留提交历史。'}</p></section><section class="panel"><div class="panelhead"><h2>建议优先关注</h2>${P('教师决定')}</div>${attention.length?attention.slice(0,3).map(g=>`<div class="priority"><div class="row"><h3>${E(g.name)}</h3>${P(g.help?'主动求助':g.latest.data.assessment.label,'amber')}</div><p>${g.latest?'查看测量变化与本组排查依据。':'本修订还没有完整的测量依据。'}</p>${B('查看并指导','group:'+g.id,'link')}</div>`).join(''):`<div class="empty">${I('check')}<p>新的求助和待核对测量会出现在这里。</p></div>`}</section></div><div class="panelhead"><h2>小组进度</h2><div class="x-tabs">${[['all','全部'],['help','求助中']].map(([v,l])=>`<button class="${(S.groupFilter||'all')===v?'on':''}" data-action="filter:${v}">${l}</button>`).join('')}</div></div><div class="group-grid">${gs.filter(g=>S.groupFilter!=='help'||g.help).map(g=>{const n=g.events.filter(e=>e.kind==='measurement'&&e.revision===g.revision).length;return `<button class="group-card ${g.help?'help':''}" data-action="group:${g.id}"><div class="row"><strong>${E(g.name)}</strong>${P(g.help?'求助中':statusLabels[g.status],g.help?'amber':g.status==='reviewed'?'green':'blue')}</div><p>${g.latest?E(g.latest.data.assessment.label):'当前修订等待首次测量'}</p><div class="x-groupmeta">${E(g.members.join('、'))}</div><div class="small muted">修订 ${g.revision} · ${n} 次测量</div></button>`}).join('')}</div>${S.groupFilter==='help'&&!help?'<p class="empty">当前没有主动求助的小组。</p>':''}`;
}
function submissionTrend(groups){
  const first=groups.map(g=>g.events.find(e=>e.kind==='submission')).filter(Boolean).sort((a,b)=>a.created.localeCompare(b.created));
  if(!first.length)return `<div class="class-chart-empty empty">${I('chart')}<p>等待第一份实验提交</p><p class="small">有提交后，显示本次课堂的变化趋势。</p></div>`;
  const points=[{time:first[0].created,value:0},...first.map((e,i)=>({time:e.created,value:i+1}))];
  const W=560,H=210,L=32,R=15,T=15,D=32,max=Math.max(groups.length,1),x=i=>L+i*(W-L-R)/(points.length-1),y=v=>H-D-v*(H-T-D)/max;
  return `<div class="chartwrap"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="提交趋势，累计首次提交的小组数"><text x="0" y="11" fill="#8191a7" font-size="12">组</text>${Array.from({length:max+1},(_,i)=>`<line x1="${L}" y1="${y(i)}" x2="${W-R}" y2="${y(i)}" stroke="#eaf0f7"/><text x="${L-9}" y="${y(i)+4}" text-anchor="end" fill="#8191a7" font-size="12">${i}</text>`).join('')}<path d="${points.map((p,i)=>(i?'L':'M')+x(i)+' '+y(p.value)).join(' ')}" fill="none" stroke="#2868e8" stroke-width="2.5"/>${points.map((p,i)=>`<circle cx="${x(i)}" cy="${y(p.value)}" r="4" fill="#2868e8" stroke="white" stroke-width="2"><title>${E(timeOnly(p.time))} · ${p.value} 组</title></circle>${i===0||i===points.length-1?`<text x="${x(i)}" y="${H-8}" text-anchor="${i?'end':'start'}" fill="#8191a7" font-size="12">${E(timeOnly(p.time))}</text>`:''}`).join('')}</svg></div>`;
}
function progressBars(gs){return `<div class="barlist">${[['working','进行中','#80a9f5'],['submitted','待复核','#5089ed'],['returned','待补充','#dfae66'],['reviewed','已反馈','#69b397']].map(([s,l,c])=>{const n=gs.filter(g=>g.status===s).length;return `<div><div class="bar-label"><span>${l}</span><span class="num">${n} 组</span></div><div class="bar-track"><div class="bar-fill" style="width:${gs.length?n/gs.length*100:0}%;background:${c}"></div></div></div>`}).join('')}</div>`}

function measurementChart(g){
  if(S.data.course.experiment.rule_type==='observation')return `<section class="panel"><div class="panelhead"><h2>实验观察与证据</h2>${P('修订 '+g.revision,'blue')}</div><p>${E(S.data.course.experiment.objective)}</p><p class="chart-note">${g.events.filter(e=>e.revision===g.revision&&e.kind==='observation').length} 条观察 · ${g.events.filter(e=>e.revision===g.revision&&e.kind==='photo').length} 张照片。当前实验采用过程记录，不套用电压判据。</p></section>`;
  const rows=g.events.filter(e=>e.kind==='measurement'),latest=g.latest;
  let content='';
  if(!rows.length)content=`<div class="empty">${I('chart')}<p>确认第一条测量后，曲线会从这里开始。</p></div>`;
  else{
    // Every recorded measurement has an x position; missing/invalid values are gaps, never zero.
    const compactChart=!isTeacher()||(window.innerWidth||1024)<580;
    const W=compactChart?360:640,H=compactChart?210:250,L=compactChart?35:49,R=compactChart?12:20,T=20,D=40, valid=rows.filter(e=>e.data.fields.vout.value_v!=null&&Math.abs(e.data.fields.vout.value_v)<=5);
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
        if(a.expected_v!=null&&pa.expected_v!=null){expect+=`<path d="M${x(i-1)} ${y(pa.expected_v)}L${px} ${y(a.expected_v)}" fill="none" stroke="#91a7c5" stroke-width="1.5" stroke-dasharray="5 4"/>`;bands+=`<polygon points="${x(i-1)},${y(pa.expected_v+(pa.tolerance_v??.05))} ${px},${y(a.expected_v+(a.tolerance_v??.05))} ${px},${y(a.expected_v-(a.tolerance_v??.05))} ${x(i-1)},${y(pa.expected_v-(pa.tolerance_v??.05))}" fill="#e8f0ff"/>`}
      }
      if(a.expected_v!=null)expect+=`<line x1="${px-9}" y1="${y(a.expected_v)}" x2="${px+9}" y2="${y(a.expected_v)}" stroke="#91a7c5" stroke-width="1.5"/>`;
      if(good)points+=`<circle cx="${px}" cy="${y(v)}" r="4.5" fill="${e.revision===g.revision?'#2868e8':'#97afd3'}" stroke="white" stroke-width="2"><title>测量 ${i+1}：${fmt(v)} V，修订 ${e.revision}</title></circle>`;
      if(rows.length<=(compactChart?6:12)||i===0||i===rows.length-1)points+=`<text x="${px}" y="${H-14}" text-anchor="middle" fill="#7687a0" font-size="12">${i+1}</text>`;
    }
    content=`<div class="chartwrap"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="输出电压测量曲线，横轴为测量序号，纵轴单位伏。修改前后曲线不连接。"><text x="8" y="14" fill="#7687a0" font-size="12">V</text>${ticks.map(v=>`<line x1="${L}" y1="${y(v)}" x2="${W-R}" y2="${y(v)}" stroke="#edf1f7"/><text x="${L-10}" y="${y(v)+4}" text-anchor="end" fill="#7687a0" font-size="12">${v.toFixed(1)}</text>`).join('')}${bands}${breaks}${expect}${lines}${points}</svg></div><div class="legend"><span>实测输出</span><span class="expected">按实测供电计算的预期</span><span class="band">±${fmt(S.data.course.experiment.tolerance_v??.05)} V</span></div><p class="chart-note">横轴：测量序号。改线前后不连线；未测、OL 或超出 ±5 V 的可疑值留空，原值保留在记录中。</p>`;
  }
  const f=latest?.data.fields,a=latest?.data.assessment;
  return `<section class="panel"><div class="panelhead"><div><span class="small muted">TP2 对 TP0 · 输出电压</span><div class="x-value">${fmt(f?.vout.value_v)} <small>${f?.vout.value_v==null?'':'V'}</small></div></div>${P(a?a.label:'等待测量',a?.code==='pass'?'green':a?'amber':'')}</div>${content}<div class="chart-note">供电 ${fmt(f?.vin.value_v)} V · 预期输出 ${fmt(a?.expected_v)} V · 当前修订 ${g.revision}</div><p class="chart-note">${latest?'依据记录 '+latest.id.slice(0,8):'改线后需重新测量供电和输出。'}</p></section>`;
}

function studentLab(){
  const g=current(),teacher=g.events.filter(e=>e.kind==='message'||e.kind==='review').at(-1),last=g.events.filter(e=>e.kind==='measurement'||e.kind==='observation').at(-1);
  return `<div class="row"><h1>${E(S.data.assignment?.title||S.data.course.experiment.title)}</h1>${P(statusLabels[g.status],'blue')}</div><div class="x-subline"><span>${g.latest?'测量与排查':'准备测量与记录'}</span><span>实物修订 ${g.revision}</span></div><div class="student-experiment-actions">${B(lastSubmission(g)?'查看结论与反馈':'实验结论','view:submit','btn','file')}</div>${measurementChart(g)}<section class="x-chat"><div class="panelhead"><h2>实验对话</h2>${B('实验说明','instructions','link')}</div>${last?`<div class="x-bubble user"><p>${E(last.data.raw)}</p><p class="small muted">已确认保存 · 修订 ${last.revision}</p></div>`:''}${S.lastQuestion?`<div class="x-bubble user"><p>${E(S.lastQuestion)}</p><p class="small muted">本次提问 · 不计入测量</p></div>`:''}${S.assist?`<div class="x-bubble ai"><div class="x-bubblehead"><span class="ai-icon">${I('spark')}</span>${S.assist.mode==='model'?'AI 助教':'实验规则建议'}</div><p class="answer-text">${E(S.assist.text)}</p><p class="small muted">${E(S.assist.notice)}</p>${sources(S.assist)}</div>`:`<div class="x-bubble ai"><div class="x-bubblehead"><span class="ai-icon">${I('spark')}</span>实验助教</div><p>${g.latest?'测量已保存，当前'+E(g.latest.data.assessment.label)+'。可以继续描述检查发现，或让我根据记录给出提示。':'把仪器读数或检查发现直接告诉我，我来帮你整理。'}</p>${!g.latest?`<p class="small muted">${S.data.course.experiment.rule_type==='observation'?'例如：我想记录本次观察，并核对实验条件和下一步检查。':'例如：供电 3.30 V，输出 80 mV，黑表笔接 TP0。'}</p>`:''}</div>`}${S.draft?draftCard():''}${teacher?`<div class="x-bubble ai"><div class="x-bubblehead">${I('book')}${E(teacher.author)} · ${teacher.kind==='review'?'教师反馈':'教师指导'}</div><p>${E(teacher.data.text)}</p><p class="small muted">${E(timeOnly(teacher.created))} · 已保存</p></div>`:''}${locked(g)?`<div class="notice">${typeof lockedNotice==='function'?E(lockedNotice(g)):g.status==='submitted'?'结论已提交，等待教师复核。':'教师已反馈，请查看实验结论。'}</div>`:`<div class="composer"><label class="sr-only" for="raw">描述测量或实验问题</label><textarea id="raw" maxlength="2000" placeholder="输入读数、检查发现，或直接提问…">${E(S.raw)}</textarea><div class="composer-foot">${B('加照片','photo','link','camera')}${B(S.online?'发送':'暂存文字','extract','primary','send')}</div></div><div class="suggestions">${B(S.data.course.experiment.rule_type==='observation'?'试填一段记录':'试填一段测量','example','btn')}${B('记录修改','revision','btn')}${B(g.help?'已发出求助':'向教师求助','help','btn')}</div>`}${pendingTexts(g)}${B('根据记录给我提示','student-assist','link','spark')}</section>`;
}
function pendingTexts(g){const list=S.pending.filter(p=>p.group===g.id);if(!list.length)return '';return `<div class="notice amber"><strong>${list.length} 段文字暂存在本机</strong>${list.map(p=>`<div class="evidence-item"><p>${E(p.text)}</p><div class="small">输入时修订 ${p.revision}${p.revision!==g.revision?' · 接线已变化，请先核对':''}</div><div class="actions">${B('载入并重新提取','pending:'+p.id,'link')}${B('删除暂存','discard:'+p.id,'link')}</div></div>`).join('')}</div>`}
function draftNumber(q){if(!q.raw.trim()||q.raw.trim().toUpperCase()==='OL'||q.raw==='无法读数')return null;const n=Number(q.raw);return Number.isFinite(n)?n*(q.unit==='mV'?.001:1):null}
function draftCard(){
  const d=S.draft,values=['vin','vout'].map(k=>draftNumber(d[k])),risky=d.kind==='measurement'&&(d.reference!=='TP0'||d.ambiguities.length||values.some(n=>n!=null&&(n<0||Math.abs(n)>5)));
  return `<div class="x-bubble ai extraction-card" aria-label="待确认提取结果"><div class="x-bubblehead"><span class="ai-icon">${I('spark')}</span>实验助教 · 请核对提取结果</div><p>我把这段话整理成了实验记录。</p><p class="raw small muted">${E(d.raw)}</p>${P('尚未计入测量')}${d.requires_revision?`<div class="notice amber">这段文字描述了实物修改。请先开启新修订，再单独输入复测读数。${B('先记录实物修改','revision','link')}</div>`:''}${d.kind==='measurement'?`<div class="x-extracted">${[['vin','供电','TP1'],['vout','输出','TP2']].map(([f,l,tp])=>`<div class="x-extract"><span>${l} · ${tp} 对 ${d.reference==='unknown'?'参考点待定':E(d.reference)}</span><strong>${draftNumber(d[f])==null?'待补充':fmt(draftNumber(d[f]))+' V'}</strong><small>原始读数：${E(d[f].raw||'未测')} ${E(d[f].unit)}</small></div>`).join('')}</div><div class="x-linechips">${P('直流电压 · 本实验模板','blue')}${P('修订 '+d.revision)}${P(d.reference==='unknown'?'参考点待确认':'参考点 '+d.reference)}</div>${d.ambiguities.length?`<div class="notice amber">${d.ambiguities.map(E).join('<br>')}</div>`:''}${d.reference==='unknown'?`<div class="suggestions">${B('黑表笔接 TP0','set-reference','btn')}</div>`:''}<details class="correction-details"><summary>修正识别结果</summary><div class="extract-fields">${[['vin','供电'],['vout','输出']].map(([f,l])=>`<div class="field"><label for="edit-${f}">${l}读数</label><div class="quantity"><input id="edit-${f}" type="text" inputmode="decimal" aria-label="${l}读数" value="${E(d[f].raw)}" placeholder="未测可留空"><select id="unit-${f}" aria-label="${l}单位"><option ${d[f].unit==='V'?'selected':''}>V</option><option ${d[f].unit==='mV'?'selected':''}>mV</option></select></div></div>`).join('')}</div><div class="field"><label for="reference">本次测量参考点 / 黑表笔</label><select id="reference">${[['unknown','尚未确认'],['TP0','TP0 · 参考地'],['TP1','TP1 · 供电'],['TP2','TP2 · 输出']].map(([v,l])=>`<option value="${v}" ${d.reference===v?'selected':''}>${l}</option>`).join('')}</select></div>${B('应用修正','apply-extract','link')}</details>${risky?`<label class="x-check"><input type="checkbox" id="acknowledged" ${d.acknowledged?'checked':''}><span>我已核对单位、符号和参考点，保留当前读数并标记待查。</span></label>`:''}`:`<div class="notice">将作为观察 / 提问保存，不自动生成测量数值。${d.suggest_revision?'如已改线或换件，请先记录实物修改再复测。':''}</div>`}<div style="margin-top:13px">${B('核对无误，记入实验','confirm','primary wide','check',d.requires_revision?'disabled':'')}</div><p class="chart-note">保留原话，确认后才更新图表和判定依据。${d.kind==='measurement'?'空白与 OL 不按 0 处理。':''}</p>${B('取消草稿','cancel-draft','link')}</div>`;
}
function timeOnly(value){return new Date(value).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit',timeZone:'Asia/Shanghai'})}
function timeline(g){return g.events.length?`<div class="timeline">${g.events.slice().reverse().map(e=>`<article class="event" id="event-${e.id}" tabindex="-1"><time datetime="${e.created}">${new Date(e.created).toLocaleDateString('zh-CN',{month:'2-digit',day:'2-digit',timeZone:'Asia/Shanghai'})}<br>${timeOnly(e.created)}</time><div class="event-body"><div class="event-title"><strong>${E(titleByKind[e.kind])}</strong>${P('修订 '+e.revision,e.revision===g.revision?'blue':'')}</div>${eventBody(e)}<div class="event-detail">${E(e.author)} · 记录 ${e.id.slice(0,8)}</div></div></article>`).join('')}</div>`:`<div class="empty">${I('clock')}<p>实验记录将按时间保存在这里。</p></div>`}
function eventBody(e){const d=e.data;if(e.kind==='measurement'){const f=d.fields,a=d.assessment;return `<p class="raw">${E(d.raw)}</p><div class="event-detail">确认值：供电 ${E(f.vin.raw||'未测')} ${E(f.vin.unit)} · 输出 ${E(f.vout.raw||'未测')} ${E(f.vout.unit)}<br>参考点：${E(f.reference)} · ${E(a.label)}</div>${a.expected_v!=null?`<div class="event-detail">预期 ${fmt(a.expected_v)} V · 实测偏差 ${fmt(a.deviation_v)} V · 容许偏差 ±${fmt(a.tolerance_v)} V（含边界）</div>`:''}${a.warnings.length?`<div class="notice amber">${a.warnings.map(E).join('<br>')}</div>`:''}<details><summary>查看最初提取与修正</summary><p>初次提取：供电 ${E(d.extracted.vin.raw||'未识别')} ${E(d.extracted.vin.unit)}，输出 ${E(d.extracted.vout.raw||'未识别')} ${E(d.extracted.vout.unit)}，参考点 ${E(d.extracted.reference)}。</p><p>${d.manually_corrected?'确认前有人工修正。':'确认值与最初提取一致。'}计算使用换算后的 V 值，原始读数与单位分别保存。</p></details>`}if(e.kind==='photo')return `${d.caption?`<p class="raw">${E(d.caption)}</p>`:''}<a href="/api/photos/${E(d.file)}" target="_blank" rel="noopener"><img class="photo" src="/api/photos/${E(d.file)}" alt="${E(d.caption||'学生上传的实验照片')}"></a><p class="chart-note">照片证据 · 尚未进行图像识别</p>`;return `<p class="raw">${E(d.raw||d.text||d.reason||d.conclusion)}</p>${e.kind==='submission'?`<div class="event-detail">关联 ${d.evidence.length} 条证据 · 提交时冻结引用</div>`:''}${e.kind==='review'?`<div class="event-detail">${d.decision==='return'?'退回补充':'已反馈'} · 关联提交 ${d.submission_id.slice(0,8)}</div>`:''}`}
function studentRecords(){const g=current();return `<div class="row"><h1>实验记录</h1>${P('本组可见')}</div><div class="x-subline"><span>原话、提取结果与操作关联保存</span></div><section class="panel">${timeline(g)}</section><div style="margin-top:16px">${B('整理实验结论','view:submit','primary wide')}</div>`}
function studentSubmit(){const g=current(),sub=lastSubmission(g),review=g.events.filter(e=>e.kind==='review').at(-1);return `${B('返回实验','view:lab','link','back')}<div class="row"><h1>${review?'教师反馈':'实验结论'}</h1>${P(statusLabels[g.status],'blue')}</div><div class="x-subline"><span>${E(S.data.assignment?.title||S.data.course.experiment.title)} · ${E(g.name)}</span></div><section class="panel"><div class="panelhead"><h3>已关联的证据</h3>${P(g.latest?g.latest.data.assessment.label:'当前修订待测',g.latest?.data.assessment.code==='pass'?'green':'amber')}</div>${S.data.course.experiment.rule_type==='observation'?'<p>已关联本组当前修订的观察与证据。</p>':`<p>供电 ${fmt(g.latest?.data.fields.vin.value_v)} V · 输出 ${fmt(g.latest?.data.fields.vout.value_v)} V</p>`}<p class="chart-note">${g.events.filter(e=>e.revision===g.revision&&e.kind==='measurement').length} 次测量 · ${g.events.filter(e=>e.revision===g.revision&&e.kind==='photo').length} 张照片 · 修订 ${g.revision}</p></section><section class="panel"><div class="field"><label for="conclusion">用自己的话解释</label><textarea id="conclusion" maxlength="3000" ${locked(g)?'readonly':''} placeholder="预期是什么？哪条证据不符？你如何检查、修改和复测？">${E(locked(g)?sub?.data.conclusion:S.conclusion||sub?.data.conclusion||'')}</textarea></div><p class="chart-note">助教可以整理记录，原理解释由你完成。</p></section>${review?`<section class="panel"><h3>${E(review.author)}的反馈</h3><p class="answer-text" style="margin-top:10px">${E(review.data.text)}</p>${review.data.decision==='return'?'<div class="notice">请补充后重新提交。</div>':''}</section>`:''}${!locked(g)?`<div style="margin-top:16px">${B('提交给教师','submit','primary wide')}</div>`:''}`}
function groupView(){const g=current(),sub=lastSubmission(g);return `${B('返回课堂','view:overview','link','back')}<div style="margin-top:12px">${heading(g.name+'实验过程',g.members.join('、')+' · 实物修订 '+g.revision,B('AI 起草本组指导','group-assist','primary','spark'))}</div><div class="twocol"><div>${measurementChart(g)}<section class="panel"><h2>过程时间线</h2>${timeline(g)}</section>${sub?`<section class="panel"><div class="panelhead"><h2>学生原始解释</h2>${P(statusLabels[g.status],'blue')}</div><div class="x-reviewtext">${E(sub.data.conclusion)}</div><p class="chart-note">提交 ${sub.id.slice(0,8)} · 修订 ${sub.revision} · ${sub.data.evidence.length} 条证据</p></section>`:''}</div><div><section class="ai-panel"><div class="ai-title"><span class="ai-icon">${I('spark')}</span><h2>实验过程摘要</h2></div><p>本组已记录 ${g.events.filter(e=>e.kind==='measurement').length} 次测量，当前${g.latest?E(g.latest.data.assessment.label):'修订尚待复测'}。请结合检查与修改记录核对，单个读数不能唯一确定故障原因。</p><div class="x-source" style="margin-top:12px"><span>已确认测量</span><span>修订 ${g.revision}</span></div></section><section class="panel"><div class="field"><label for="message">给本组的指导</label><textarea id="message" maxlength="3000" placeholder="可以先用助教起草，再修改发送。">${E(S.message)}</textarea></div>${B('确认并发送','send-message','primary','send')}${S.assist?`<p class="chart-note">${E(S.assist.notice)}</p>${sources(S.assist)}`:''}</section>${g.status==='submitted'?`<section class="panel"><h3>教师反馈</h3><div class="field"><label class="sr-only" for="feedback">教师反馈内容</label><textarea id="feedback" maxlength="3000" placeholder="指出已有证据和需要补充的解释。">${E(S.feedback)}</textarea></div><div class="actions">${B('确认并反馈','review:feedback','primary')}${B('退回补充','review:return','btn')}</div><p class="chart-note">教师保留决定权，不自动生成最终成绩。</p></section>`:''}</div></div>`}
function reports(){const gs=S.data.groups.filter(g=>lastSubmission(g));return `${heading('实验提交','先读证据摘要，再核对学生解释。',B('AI 起草反馈','prepare-feedback','primary','spark'))}<section class="panel"><div class="panelhead"><h2>${E(S.data.assignment?.title||S.data.course.experiment.title)}</h2>${P(gs.length+' 份提交','blue')}</div><table class="report-table"><thead><tr><th>小组</th><th>复核状态</th><th class="desktop-only">证据</th><th>操作</th></tr></thead><tbody>${gs.map(g=>`<tr><td>${E(g.name)}</td><td>${P(statusLabels[g.status],g.status==='reviewed'?'green':'blue')}</td><td class="desktop-only">修订 ${lastSubmission(g).revision} · ${lastSubmission(g).data.evidence.length} 条证据</td><td>${B('查看','group:'+g.id,'link')}</td></tr>`).join('')}</tbody></table>${!gs.length?'<div class="empty">学生提交后会显示在这里。</div>':''}</section>`}
function sources(answer){return `<div class="sources">${answer.evidence.slice(-12).map(e=>`<button data-action="source:${e.id}" title="查看原始记录">${E(e.group)} · ${E(titleByKind[e.kind]||e.kind)} ${e.id.slice(0,8)}</button>`).join('')}</div>`}
function assistCard(editable){return `<section class="panel ai-answer"><div class="panelhead"><h2>${S.assist.mode==='model'?'AI 建议草稿':'实验规则建议'}</h2>${P('待核对','blue')}</div><p class="small muted" style="margin-bottom:13px">${E(S.assist.notice)}</p>${editable?`<label for="assist-text">可编辑的教学草稿</label><textarea id="assist-text" maxlength="8000">${E(S.assist.text)}</textarea>`:`<div class="bubble">${E(S.assist.text)}</div>`}${sources(S.assist)}${editable?`<p class="chart-note">选择具体小组生成后，可放入该组指导框，核对后发送。</p>${S.assistTarget?B('放入本组指导框','use-assist','link'):''}`:''}</section>`}
function assistPage(){return `${heading('AI 教学助教','描述教学任务，先预览草稿，再确认执行。',P('教师保留决定权','blue'))}<div class="x-copilot"><section class="ai-panel"><div class="ai-title"><span class="ai-icon">${I('spark')}</span><h2>这节课，我可以帮您处理</h2></div><p>梳理求助、准备分组指导、起草反馈、整理课后小结。</p><div class="suggestions">${B('给待帮助组准备提示','prepare-guidance','btn')}${B('为已提交组起草反馈','prepare-feedback','btn')}${B('准备全班共性讲解','common','btn')}</div></section><div class="composer"><label class="sr-only" for="question">描述教师任务</label><textarea id="question" maxlength="1500" placeholder="例如：给输出偏低的小组准备补测指导，并列出依据。">${E(S.question)}</textarea><div class="composer-foot"><label class="sr-only" for="assist-target">使用哪些记录</label><select id="assist-target" class="scope-select"><option value="">${E(S.data.assignment?.title||S.data.course.experiment.title)} · 当前范围</option>${S.data.groups.map(g=>`<option value="${g.id}" ${S.assistTarget===g.id?'selected':''}>${E(g.name)} · 本组记录</option>`).join('')}</select>${B('生成草稿','assist','primary','spark')}</div></div>${S.assist?`<div style="margin-top:24px">${assistCard(true)}</div>`:''}</div>`}
function experimentPage(){const e=S.data.course.experiment;return `${heading('实验模板','目标、测点与判据由教师确认后使用。',B('AI 准备教学材料','template-ai','primary','spark'))}<section class="panel"><div class="panelhead"><h2>${E(e.title)}</h2>${P('v'+e.version+' · 当前实验包','green')}</div><p>3.3 V 低压直流 · 两只 10 kΩ 电阻 · TP0、TP1、TP2</p><div class="x-linechips">${P(e.steps.length+' 个实验步骤')}${P('分层指导')}${P('测量与过程评价')}</div>${B('查看学习目标与步骤','instructions','link')}<details><summary>查看测点与数值判据</summary><p>${E(e.objective)}</p><p>${E(e.formula)}</p><p class="small muted">${Object.entries(e.points).map(([k,v])=>E(k+'：'+v)).join(' · ')}</p><div class="notice">供电实测 3.20–3.40 V，参考点 TP0；输出与实测供电一半的偏差 ≤ 0.050 V（含边界），判为符合数值判据。</div></details><p class="chart-note">当前实验包只读。更多学科将分别定义量、单位、判据和安全约束。</p></section>`}
function dialog(){let title='',body='';if(S.modal==='teaching')return teachingDialog();if(S.modal==='instructions'){const e=S.data.course.experiment;title=e.title;body=`<p>${E(e.objective)}</p><p>${E(e.materials||'')}</p><ol>${e.steps.map(x=>`<li>${E(x)}</li>`).join('')}</ol><div class="notice">${E(e.formula)}${e.rule_type==='observation'?'':`<br>供电范围 ${e.supply_min_v}–${e.supply_max_v} V；输出容许偏差 ±${e.tolerance_v} V。`}</div><div class="notice amber">${E(e.safety)}</div>${e.report_instructions?`<p>报告要求：${E(e.report_instructions)}</p>`:''}<div style="margin-top:20px">${B('返回实验','close','primary wide')}</div>`}if(S.modal==='revision'){title='记录实物修改';body=`<p>改线或换件后建立新修订，旧测量留在过程记录。新修订需要重新测量供电和输出。</p><div class="notice amber" style="margin-bottom:17px">请先断电，再改线、换件或测电阻。</div><label for="revision-reason">这次修改了什么</label><textarea id="revision-reason" maxlength="1000" placeholder="例如：断电后重新连接 R2 下端到 TP0。">${E(S.revisionReason)}</textarea><div style="margin-top:18px">${B('确认修改，开启新修订','save-revision','primary wide')}</div>`}if(S.modal==='help'){title='向教师求助';body=`<p>说明已经检查的内容，教师可以直接看到本组过程记录。</p><label for="help-text">需要什么帮助</label><textarea id="help-text" maxlength="1000" placeholder="例如：参考点和供电已核对，输出仍偏低，不知道下一步测哪里。">${E(S.helpText)}</textarea><div style="margin-top:18px">${B('确认发送求助','save-help','primary wide')}</div>`}if(S.modal==='photo'){title='添加实验照片';body=`<p>支持 JPEG、PNG，最大 4 MB。照片作为原始证据保存，本版不进行图像识别。</p><div class="field"><label for="photo-file">选择照片</label><input id="photo-file" type="file" accept="image/jpeg,image/png"></div><label for="photo-caption">照片说明（可选）</label><input id="photo-caption" maxlength="300" value="${E(S.photoCaption)}" placeholder="例如：本次复测前的接线和表笔位置"><div style="margin-top:18px">${B('保存到本组记录','save-photo','primary wide')}</div>`}return `<div class="overlay"><section class="dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title"><div class="panelhead"><h2 id="dialog-title">${title}</h2><button class="close" data-action="close" aria-label="关闭">${I('close')}</button></div>${body}${S.error?`<div class="error" role="alert">${E(S.error)}</div>`:''}</section></div>`}

async function getAssist(question,gid){
  toast('正在根据已保存的记录整理建议…');
  const answer=await api('/assist',{question,group_id:gid||undefined,...(typeof T!=='undefined'?{offering_id:T.offeringId||undefined,assignment_id:T.assignmentId||undefined,class_id:T.classId||undefined}:{})});S.assist=answer;return answer;
}
async function extractText(){
  if(!S.raw.trim())throw new Error('请先输入一段测量或检查描述');
  if(!S.online){stashText();return}
  const text=S.raw;
  try{
    const draft=await api('/groups/'+current().id+'/extract',command({text,revision:current().revision}));
    S.raw='';
    if(draft.kind==='observation'&&/[?？]|怎么|为什么|如何|应该|下一步|不明白|能不能|是否/.test(text)){
      S.draft=null;S.lastQuestion=text;await getAssist(text,current().id);
    }else{S.draft=draft;S.lastQuestion=''}
  }
  catch(e){if(e.network){S.online=false;S.raw=text;stashText()}else throw e}
}
async function action(name){
  if(typeof teachingAction==='function'&&await teachingAction(name))return;
  const [a,v]=name.split(':');
  if(a==='login-role'){S.loginRole=v;S.loginUser=v==='teacher'?'teacher':'student1';S.error='';return}
  if(a==='logout'){await api('/logout',{});S.data=null;S.draft=null;S.raw='';S.assist=null;S.lastQuestion='';S.pending=[];S.error='';S.message='';S.feedback='';S.conclusion='';S.modal=null;return}
  if(a==='chart'){S.classChart=v;return}
  if(a==='filter'){S.groupFilter=v;return}
  if(a==='apply-extract')return;
  if(a==='set-reference'){if(S.draft)S.draft.reference='TP0';return}
  if(['prepare-guidance','prepare-feedback','common','template-ai'].includes(a)){S.view='assist';S.assist=null;S.assistTarget='';S.question={'prepare-guidance':'给待帮助的小组准备补测指导，列出已有依据和仍需区分的原因。','prepare-feedback':'请依据已提交的实验结论和测量，起草教师反馈。','common':'请根据已记录问题，准备全班共性讲解，区分已有证据和待核对假设。','template-ai':'请为'+S.data.course.experiment.title+'准备课前引导、反思问题与评价关注点。'}[a];return}
  if(a==='view'){S.view=v;S.error='';S.assist=null;return}
  if(a==='group'){S.gid=v;S.view='group';S.message='';S.feedback='';S.assist=null;return}
  if(a==='close'){S.modal=null;S.error='';return}
  if(['instructions','revision','help','photo'].includes(a)){S.modal=a;S.error='';return}
  if(a==='example'){S.raw=S.data.course.experiment.rule_type==='observation'?'我想记录本次观察，并核对实验条件和下一步检查。':'供电 3.30 V，输出 80 mV，黑表笔接 TP0。';return}
  if(a==='cancel-draft'){S.draft=null;return}
  if(a==='extract'){await extractText();return}
  if(a==='confirm'){
    const d=S.draft;if(!d)return;
    const payload=command({draft_id:d.id,revision:d.revision,vin:d.vin,vout:d.vout,reference:d.reference,acknowledged:!!d.acknowledged});
    await api('/groups/'+current().id+'/records',payload);S.draft=null;S.assist=null;toast('记录已保存，师生两端共享同一份依据');await refresh(false);return;
  }
  if(a==='pending'){const p=S.pending.find(p=>p.id===v);S.raw=p.text;S.pending=S.pending.filter(x=>x.id!==v);persistPending();return}
  if(a==='discard'){S.pending=S.pending.filter(x=>x.id!==v);persistPending();return}
  if(a==='save-revision'){await api('/groups/'+current().id+'/revision',command({revision:current().revision,reason:$('#revision-reason').value}));S.draft=null;S.assist=null;S.lastQuestion='';S.modal=null;S.revisionReason='';await refresh(false);toast('已开启新修订，请重新测量供电和输出');return}
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
  try{await api('/login',{username:S.loginUser,password:S.loginPassword});await refresh(false);S.view=typeof T!=='undefined'?'courses':isTeacher()?'overview':'lab';S.pending=JSON.parse(localStorage.getItem(key('pending'))||'[]');S.gid=S.data.groups[0]?.id}
  catch(e){S.error=e.network?'暂时无法连接服务，请稍后重试。':e.message}finally{S.busy=false;render()}
});
root.addEventListener('input',capture);
root.addEventListener('change',event=>{if(typeof teachingChange==='function')teachingChange(event)});
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
(async()=>{try{await refresh(false);S.view=typeof T!=='undefined'?'courses':isTeacher()?'overview':'lab';S.pending=JSON.parse(localStorage.getItem(key('pending'))||'[]')}catch(e){if(e.status!==401)S.error='服务暂不可用，请稍后刷新。'}render()})();
