'use strict';
// Teaching navigation extends the approved experiment workspace; data still comes from one API.
const T={catalog:null,offeringId:'',assignmentId:'',classId:'',form:{},dialog:'',preview:null,authMode:'login'};
const teachingOffering=()=>T.catalog?.offerings.find(o=>o.id===T.offeringId);
const teachingAssignments=()=>T.catalog?.assignments.filter(a=>a.offering_id===T.offeringId)||[];
const teachingAssignment=()=>T.catalog?.assignments.find(a=>a.id===T.assignmentId);
const teachingClass=id=>T.catalog?.offerings.flatMap(o=>o.classes).find(c=>c.id===id);
const teachingScheme=id=>T.catalog?.offerings.flatMap(o=>o.classes).flatMap(c=>c.schemes).find(s=>s.id===id);
const teachingTeam=id=>T.catalog?.offerings.flatMap(o=>o.classes).flatMap(c=>c.schemes).flatMap(s=>s.teams).find(t=>t.id===id);
const teachingViews=['courses','content','classes','tasks','teams'];

async function teachingLoad(isCurrent=()=>true){
  const catalog=await api('/catalog');
  if(!isCurrent())return null;
  if(T.catalog?.user.id!==catalog.user.id){
    const saved=JSON.parse(localStorage.getItem('lab:'+catalog.user.id+':teaching-context')||'{}');
    T.offeringId=saved.offeringId||'';T.assignmentId=saved.assignmentId||'';T.classId='';
  }
  T.catalog=catalog;
  if(!catalog.offerings.some(o=>o.id===T.offeringId))T.offeringId=catalog.offerings.find(o=>!o.archived)?.id||catalog.offerings[0]?.id||'';
  const choices=teachingAssignments();
  if(!choices.some(a=>a.id===T.assignmentId))T.assignmentId=choices[0]?.id||'';
  if(!teachingOffering()?.classes.some(c=>c.id===T.classId)||T.assignmentId&&!teachingAssignment()?.targets.some(t=>t.class_id===T.classId))T.classId='';
  const parts=[];
  if(T.offeringId)parts.push('offering_id='+encodeURIComponent(T.offeringId));
  if(T.assignmentId)parts.push('assignment_id='+encodeURIComponent(T.assignmentId));
  if(T.classId)parts.push('class_id='+encodeURIComponent(T.classId));
  return '/state'+(parts.length?'?'+parts.join('&'):'');
}
function teachingRemember(){if(T.catalog)localStorage.setItem('lab:'+T.catalog.user.id+':teaching-context',JSON.stringify({offeringId:T.offeringId,assignmentId:T.assignmentId}))}
function teachingCapture(){
  root.querySelectorAll('[data-field]').forEach(el=>{T.form[el.dataset.field]=el.type==='checkbox'?el.checked:el.value});
  const lists=[...root.querySelectorAll('[data-list]')];
  for(const name of new Set(lists.map(el=>el.dataset.list)))T.form[name]=lists.filter(el=>el.dataset.list===name&&el.checked).map(el=>el.value);
}
function teachingDate(value){if(!value)return null;const d=new Date(value);if(!Number.isFinite(d.getTime()))throw new Error('请核对日期时间');return d.toISOString()}
function teachingLocal(value){if(!value)return '';const d=new Date(value);return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16)}
function teachingWhen(value){return value?new Date(value).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}):'未限制'}
function teachingBlock(g){
  if(!g?.assignment_id)return '';
  if(g.archived)return '该学期开课已归档，当前可查看历史记录。';
  if(g.assignment_status!=='published')return '教师已结束此任务，当前可查看实验记录。';
  if(g.opens_at&&Date.now()<new Date(g.opens_at).getTime())return '实验尚未开放，可以先查看说明并完成组队。';
  if(g.closes_at&&Date.now()>new Date(g.closes_at).getTime())return '实验已过截止时间，如需补充请联系教师调整时间。';
  if(g.member_count<g.min_size)return '小组至少需要 '+g.min_size+' 人，请先完成组队。';
  return '';
}
function lockedNotice(g){return teachingBlock(g)||(g.status==='submitted'?'结论已提交，等待教师复核。如需补充，请联系教师退回。':'教师已反馈，请查看实验结论。如需补充，请联系教师退回。')}
function teachingHeader(){
  return `<header class="x-head"><div class="x-brand"><span class="x-mark">${I('circuit')}</span>验知有道<span class="x-headnote">教师工作台</span></div><div class="actions"><span class="x-avatar">${E(S.data.user.name[0])}</span><span class="small muted">${E(S.data.user.name)}</span>${B('退出','logout','link')}</div></header>`;
}
function teachingContext(){
  const o=teachingOffering(),tasks=teachingAssignments();
  return `<div class="teaching-context"><div><label for="course-context">学期课程</label><select id="course-context" data-context="offering"><option value="">选择学期课程</option>${(T.catalog?.offerings||[]).map(o=>`<option value="${o.id}" ${T.offeringId===o.id?'selected':''}>${E(o.term)} · ${E(o.title)}${o.archived?'（已归档）':''}</option>`).join('')}</select></div><div><label for="task-context">实验任务</label><select id="task-context" data-context="assignment"><option value="">${tasks.length?'选择实验任务':'当前课程尚未发布实验'}</option>${tasks.map(a=>`<option value="${a.id}" ${T.assignmentId===a.id?'selected':''}>${E(a.title)}</option>`).join('')}</select></div>${o?`<div><label for="class-context">教学班</label><select id="class-context" data-context="class"><option value="">全部教学班</option>${o.classes.filter(c=>!teachingAssignment()||teachingAssignment().targets.some(t=>t.class_id===c.id)).map(c=>`<option value="${c.id}" ${T.classId===c.id?'selected':''}>${E(c.name)}</option>`).join('')}</select></div>`:''}</div>`;
}
function teachingSidebar(){
  const nav=(id,label,icon)=>`<button class="${S.view===id||(id==='overview'&&S.view==='group')?'on':''}" data-action="view:${id}">${I(icon)}${label}</button>`;
  return `<aside class="x-side"><span class="x-sidelabel">教学资源</span>${nav('courses','我的课程','book')}${nav('content','实验讲义','lab')}<span class="x-sidelabel teaching-navlabel">当前课程</span>${nav('overview','教学总览','grid')}${nav('classes','班级与分组','users')}${nav('tasks','实验任务','file')}${nav('reports','实验提交','check')}${nav('assist','AI 助教','spark')}<div class="x-sidefoot">${E(teachingOffering()?.term||'选择学期课程')}<br>${E(teachingOffering()?.title||'开始教学准备')}</div></aside>`;
}
function teachingShell(){
  const error=S.error?`<div class="error" role="alert">${E(S.error)}</div>`:'';
  if(isTeacher())return `<div class="teacher-stage"><div class="x-shell">${teachingHeader()}<div class="x-layout">${teachingSidebar()}<main class="x-main">${teachingContext()}${teacherView()}${error}<footer class="sync-foot">${connection()}</footer></main></div></div></div>`;
  const workspace=['lab','records','submit','mine'].includes(S.view);
  const o=teachingOffering(),g=current();
  return `<div class="x-stage student-stage"><div class="x-phone">
    <header class="x-phonehead"><div class="row"><div class="x-brand"><span class="x-mark">${I('circuit')}</span>验知有道</div><div class="actions">${workspace?B('课程','view:tasks','link'):''}<span class="x-avatar">${E(S.data.user.name[0])}</span>${B('退出','logout','link')}</div></div><div class="x-subline" style="margin:10px 0 0"><span>${E(workspace?o?.title||S.data.course.title:S.data.user.name)}${workspace&&g?' · '+E(g.name):''}</span><span>${S.online?'已同步':'连接中断'}</span></div></header>
    <main class="x-phonebody">${workspace?studentView():teachingStudentPortal()}${error}<div class="student-mode small muted">${S.data.model_configured?'模型建议需核对':'规则助教模式'} · 原话与确认记录分别保留</div></main>
    ${studentNav()}
  </div></div>`;
}
function teachingView(){
  return ({courses:teachingCourses,content:teachingContent,classes:teachingClasses,tasks:teachingTasks,teams:teachingGroups}[S.view]||teachingCourses)();
}
function teachingCourses(){
  const courses=T.catalog.courses,offerings=T.catalog.offerings;
  return `${heading('我的课程','按学期组织课程，复用实验内容，保留教学历史。',`<div class="actions">${B('创建课程','manage:course','primary','book')}${B('开设学期课程','manage:offering','btn')}</div>`)}${!offerings.length?'<div class="empty">先创建课程，再开设学期课程并建立教学班。</div>':''}<div class="course-grid">${offerings.map(o=>`<section class="panel course-card"><div class="row"><span class="small muted">${E(o.term)}</span>${P(o.archived?'已归档':'授课中',o.archived?'':'blue')}</div><h2>${E(o.title)}</h2><p class="small muted">${o.classes.length} 个教学班 · ${T.catalog.assignments.filter(a=>a.offering_id===o.id).length} 个实验任务</p><div class="actions">${B('进入课程','open-offering:'+o.id,'primary')}${B('复制到新学期','clone-offering:'+o.id,'link')}${B(o.archived?'恢复开课':'归档','archive-offering:'+o.id,'link')}</div></section>`).join('')}</div><section class="panel" style="margin-top:20px"><div class="panelhead"><h2>课程库</h2><span class="small muted">同一课程可在不同学期开设</span></div>${courses.map(c=>`<div class="resource-row"><div><strong>${E(c.title)}</strong><p class="small muted">${offerings.filter(o=>o.course_id===c.id).length} 次开课</p></div>${B('开设学期课程','open-course:'+c.id,'link')}</div>`).join('')||'<p class="muted">还没有创建课程。</p>'}</section>`;
}
function teachingContent(){return `${heading('实验讲义','编写或起草讲义，核对后按版本发布给学生。',B('创建实验讲义','manage:template','primary','lab'))}<div class="stack">${T.catalog.templates.map(t=>{const v=t.versions[0],p=v.package;return `<section class="panel"><div class="panelhead"><h2>${E(t.title)}</h2>${P('版本 '+v.number,'blue')}</div><p>${E(p.objective)}</p><div class="x-linechips">${P(p.subject||'未分类')}${P(p.steps.length+' 个步骤')}${P(p.rule_type==='observation'?'观察记录':'分压数值判定')}</div><details><summary>查看讲义与历史版本</summary>${handoutMarkup(p)}<div class="x-linechips">${t.versions.map(v=>P('版本 '+v.number+' · '+v.title)).join('')}</div></details><div class="actions" style="margin-top:14px">${B('编辑并保存新版本','edit-template:'+t.id,'btn')}${B('复制内容','copy-template:'+t.id,'link')}${B('发布实验','publish-template:'+v.id,'primary')}</div></section>`}).join('')||'<section class="panel empty">先创建实验内容，再向教学班发布。</section>'}</div>`}
function teachingClasses(){
  const o=teachingOffering();if(!o)return '<div class="empty">请先选择或开设学期课程。</div>';
  return `${heading('班级与分组',o.title+' · '+o.term,B('建立教学班','manage:class','primary','users',o.archived?'disabled':''))}${o.classes.map(c=>`<section class="panel"><div class="panelhead"><h2>${E(c.name)}</h2><div class="actions">${P(c.students.length+' 位学生','blue')}${B('添加学生','add-roster:'+c.id,'btn','',o.archived?'disabled':'')}</div></div><div class="invite-code">班级邀请码 <strong>${E(c.join_code)}</strong><span class="small muted">学生注册并登录后，使用此码加入。</span></div><details><summary>查看学生名单</summary>${c.students.length?`<div class="roster-list">${c.students.map(p=>`<div class="resource-row"><span>${E(p.name)} <span class="small muted">${E(p.username)}</span></span>${B('移出班级','remove-student:'+c.id+':'+p.id,'link','',o.archived?'disabled':'')}</div>`).join('')}</div>`:'<p class="muted">还没有学生，可添加已注册账号或发送邀请码。</p>'}</details>${c.schemes.map(s=>teachingSchemeCard(s,c,o)).join('')}</section>`).join('')||'<section class="panel empty">建立教学班后添加学生，再发布实验。</section>'}<section class="panel" style="margin-top:20px"><div class="panelhead"><h2>协作教师</h2>${B('添加协作教师','manage:collaborator','link','',o.archived?'disabled':'')}</div><p>${o.teachers.map(p=>E(p.name)+'（'+E(p.username)+'）').join('、')}</p></section>`;
}
function teachingSchemeCard(s,c,o){
  const assigned=new Set(s.teams.flatMap(t=>t.members.map(p=>p.id))),unassigned=c.students.filter(p=>!assigned.has(p.id));
  return `<div class="scheme-section"><div class="row"><h3>${E(s.name)}</h3>${P(s.min_size+'–'+s.max_size+' 人 / 组')}</div><p class="small muted">${s.mode==='self'?'学生自主组队':'教师安排分组'} · ${unassigned.length} 人未分组 · 选组截止 ${teachingWhen(s.deadline)}</p><div class="actions">${B('建立小组','teacher-team:'+s.id,'link','',o.archived?'disabled':'')}${B('自动分配未选组学生','auto-assign:'+s.id,'link','',o.archived?'disabled':'')}${B('调整选组截止','scheme-deadline:'+s.id,'link','',o.archived?'disabled':'')}</div><div class="team-grid">${s.teams.map(t=>`<div class="team-card"><div class="row"><strong>${E(t.name)}</strong>${P(t.locked?'成员已锁定':t.members.length+' 人',t.locked?'':'blue')}</div><p>${t.members.map(p=>E(p.name)).join('、')||'等待成员加入'}</p>${B('调整成员','edit-members:'+t.id,'link','',o.archived?'disabled':'')}</div>`).join('')}</div></div>`;
}
function teachingTasks(){
  const o=teachingOffering();if(!o)return '<div class="empty">请先选择学期课程。</div>';
  return `${heading('实验任务',o.title+' · '+o.term,B('发布实验','manage:publish','primary','file',o.archived?'disabled':''))}<div class="stack">${teachingAssignments().map(a=>`<section class="panel"><div class="panelhead"><h2>${E(a.title)}</h2>${P(a.status==='published'?'已发布':'已结束',a.status==='published'?'blue':'')}</div><p class="small muted">${a.targets.map(t=>E(t.class_name)).join('、')} · 实验版本 ${E(a.experiment.version)}</p><p class="small muted">开放 ${teachingWhen(a.opens_at)} · 截止 ${teachingWhen(a.closes_at)}</p><div class="actions" style="margin-top:14px">${B('查看实验进展','open-assignment:'+a.id,'primary')}${B('分组管理','assignment-groups:'+a.id,'btn')}${B('调整时间或结束任务','schedule:'+a.id,'link','',o.archived?'disabled':'')}</div></section>`).join('')||'<section class="panel empty">先准备实验内容和教学班，再发布第一项任务。</section>'}</div>`;
}
function studentTaskCard(assignment){
  const hasRun=assignment.my_runs.length>0;
  const teams=assignment.targets.flatMap(({class_id,scheme_id})=>
    teachingClass(class_id)?.schemes.find(s=>s.id===scheme_id)?.teams||[]
  );
  const names=teams.filter(team=>team.mine).map(team=>team.name);
  const groupLabel=names.length?'小组：'+names.join('、'):'已选组';
  return `<section class="panel student-task-card">
    <div class="panelhead"><h2>${E(assignment.title)}</h2>${hasRun?P(groupLabel,'blue'):P('待选组')}</div>
    <p>${E(assignment.experiment.objective)}</p>
    <p class="chart-note">截止 ${teachingWhen(assignment.closes_at)}</p>
    <div class="actions" style="margin-top:14px">
      ${B(hasRun?'进入实验':'选组并开始','student-task:'+assignment.id,'primary')}
      ${B('实验讲义','read-handout:'+assignment.id,'link','book')}
      ${hasRun?B('查看分组','student-groups:'+assignment.id,'link'):''}
    </div>
  </section>`;
}
function teachingStudentPortal(){
  if(S.view==='teams')return teachingGroups();
  if(S.view==='tasks'&&teachingOffering()){
    const o=teachingOffering();return `${B('我的课程','view:courses','link')}<h1>${E(o.title)}</h1><p class="small muted" style="margin:8px 0 18px">${E(o.term)} · ${o.classes.map(c=>E(c.name)).join('、')}</p>${teachingAssignments().map(studentTaskCard).join('')||'<div class="empty">老师还没有向本班发布实验。</div>'}`;
  }
  return `<div class="panelhead"><h1>我的课程</h1>${B('加入班级','manage:enroll','link')}</div><p class="small muted" style="margin-bottom:18px">选择本学期课程，查看任务并与同伴开展实验。</p>${T.catalog.offerings.map(o=>`<section class="panel"><div class="panelhead"><h2>${E(o.title)}</h2>${o.archived?P('已归档'):P(o.classes.length+' 个教学班','blue')}</div><p class="small muted">${E(o.term)} · ${o.classes.map(c=>E(c.name)).join('、')}</p><div style="margin-top:14px">${B('查看实验任务','open-offering:'+o.id,'primary')}</div></section>`).join('')||'<section class="panel empty">还未加入教学班，请向老师获取班级邀请码。</section>'}`;
}
function teachingGroups(){
  const a=teachingAssignment();if(!a)return '<div class="empty">请先选择实验任务。</div>';
  const run=current();
  return `${B('返回任务','view:tasks','link')}<h1 style="margin-top:12px">${E(a.title)}</h1><p class="small muted" style="margin:7px 0 18px">选择小组后共享实验空间，每条记录保留提交者。</p>${a.targets.map(target=>{
    const c=teachingClass(target.class_id),s=c?.schemes.find(s=>s.id===target.scheme_id);if(!s)return '';
    const mine=s.teams.find(t=>t.mine),closed=s.deadline&&Date.now()>new Date(s.deadline).getTime(),archived=teachingOffering()?.archived;
    return `<section class="panel"><div class="panelhead"><h2>${E(c.name)}</h2>${P(s.min_size+'–'+s.max_size+' 人 / 组','blue')}</div><p class="small muted">${s.mode==='self'?'学生自主选择':'教师安排分组'} · 截止 ${teachingWhen(s.deadline)}</p>${!mine&&s.allow_create&&s.mode==='self'&&!closed&&!archived?`<div class="actions" style="margin-top:14px">${s.min_size===1?B('我一个人完成','solo-team:'+s.id,'primary'):''}${B('创建小组','student-team:'+s.id,'btn')}</div>`:''}${closed&&!mine?'<div class="notice">选组已截止，请联系教师安排。</div>':''}<div class="team-grid">${s.teams.map(t=>`<div class="team-card ${t.mine?'mine':''}"><div class="row"><strong>${E(t.name)}</strong>${P(t.members.length+'/'+s.max_size+' 人',t.mine?'blue':'')}</div><p>${t.members.map(p=>E(p.name)).join('、')||'等待成员'}</p>${t.mine?`<div class="actions">${B('进入实验',run?.assignment_id===a.id&&run.team_id===t.id?'view:lab':'student-enter:'+a.id,'primary')}${!t.locked&&!archived?B('退出小组','leave-team:'+t.id,'link'):P('成员已锁定')}</div>`:!mine&&s.mode==='self'&&!closed&&!archived?B(t.locked?'已开始实验':t.members.length>=s.max_size?'人数已满':'加入此组','join-team:'+t.id,'btn','',t.locked||t.members.length>=s.max_size?'disabled':''):''}</div>`).join('')||'<p class="small muted">当前没有小组。</p>'}</div></section>`;
  }).join('')}`;
}

function tf(name,label,type='text',placeholder=''){
  const value=T.form[name]??'';
  return `<div class="field"><label for="tf-${name}">${label}</label>${type==='textarea'?`<textarea id="tf-${name}" data-field="${name}" placeholder="${E(placeholder)}">${E(value)}</textarea>`:`<input id="tf-${name}" data-field="${name}" type="${type}" ${type==='number'?'step="any"':''} value="${E(value)}" placeholder="${E(placeholder)}">`}</div>`;
}
function ts(name,label,options){return `<div class="field"><label for="tf-${name}">${label}</label><select id="tf-${name}" data-field="${name}">${options.map(([v,l])=>`<option value="${E(v)}" ${String(T.form[name]??'')===String(v)?'selected':''}>${E(l)}</option>`).join('')}</select></div>`}
function teachingOpen(dialog,form={}){T.dialog=dialog;T.form=JSON.parse(JSON.stringify(form));T.preview=null;S.modal='teaching';S.error=''}
function teachingTermFields(){return ts('term_id','学期',[['','新建学期'],...T.catalog.terms.map(t=>[t.id,t.name])])+(!T.form.term_id?tf('term_name','新学期名称','text','例如：2026至2027学年第二学期'):'')}
function teachingHandoutFields(f){
  const draft=S.data.model_configured?`<div class="panel handout-draft">
    <div class="panelhead"><h3>AI 起草讲义</h3>${B('生成讲义草稿','draft-handout','btn','spark')}</div>
    ${tf('handout_notes','备课要点','textarea','写下实验想让学生学会什么、使用的器材、你已确定的步骤与注意事项。')}
    <p class="small muted">AI 只填空白栏目。请核对原理、步骤、参数和安全事项，再保存或发布。</p>
    ${f.handout_generated?'<p class="small muted" role="status">草稿已整理到空白栏目，请检查并补齐。</p>':''}
  </div>`:'';
  const fields=tf('title','实验名称')+tf('subject','所属学科','text','例如：电子电路、普通物理')+
    ts('rule_type','记录与判定方式',[['resistor-divider','电阻分压 · 电压判据'],['observation','通用实验 · 观察记录']])+
    tf('objective','学习目标','textarea')+tf('principle','实验原理','textarea')+tf('materials','器材与材料','textarea')+
    tf('preparation','课前准备','textarea')+tf('steps_text','实验步骤（每行一步）','textarea')+
    tf('safety','操作注意事项','textarea')+tf('report_instructions','报告要求','textarea');
  if(f.rule_type!=='resistor-divider')return draft+fields;
  return draft+fields+`<details><summary>分压参数与数值判据</summary><p class="small muted">测点固定为 TP0 参考地、TP1 供电、TP2 输出。用于 0–5 V 低压教学。</p><div class="extract-fields">${tf('r1_ohm','R1，Ω','number')}${tf('r2_ohm','R2，Ω','number')}${tf('supply_min_v','供电下限，V','number')}${tf('supply_max_v','供电上限，V','number')}${tf('tolerance_v','输出容许偏差，V','number')}</div></details>`;
}
function teachingDialog(){
  let title='',body='',button='保存';const f=T.form,o=teachingOffering();
  switch(T.dialog){
    case 'course':title='创建课程';body=tf('title','课程名称','text','例如：电子电路基础');break;
    case 'offering':title='开设学期课程';body=ts('course_id','课程',T.catalog.courses.map(c=>[c.id,c.title]))+teachingTermFields();break;
    case 'clone':title='复制开课到新学期';body='<p>复制教学班名称与课程结构，新学期重新安排学生和实验任务。</p>'+teachingTermFields();break;
    case 'archive':title=f.archived?'归档本学期开课':'恢复本学期开课';body=`<p>${f.archived?'归档后保留教学历史，实验和名单转为只读。':'恢复后可以继续管理课程和实验。'}</p><p>${E(f.label)}</p>`;button='确认'+(f.archived?'归档':'恢复');break;
    case 'class':title='建立教学班';body=tf('name','教学班名称','text','例如：2026级软件工程1班');break;
    case 'roster':title='添加学生名单';body='<p>填写已注册学生账号，一行一个；也可粘贴“账号 姓名”或 CSV 的账号列。</p>'+tf('roster','学生账号','textarea','student1 林同学\nstudent2 陈同学');break;
    case 'remove-student':title='移出教学班';body=`<p>确认将 ${E(f.label)} 移出当前教学班？历史实验记录保留作者。</p>`+tf('reason','调整原因（已开始实验时必填）','textarea');button='确认移出';break;
    case 'collaborator':title='添加协作教师';body='<p>添加后，该教师可查看并管理本次开课的教学班与实验。</p>'+tf('username','教师账号');break;
    case 'template':case 'template-version':
      title=T.dialog==='template'?'创建实验讲义':'编辑实验讲义';body=teachingHandoutFields(f);button='保存讲义版本';break;
    case 'template-copy':title='复制实验内容';body=tf('title','副本名称');break;
    case 'publish':
      title=T.preview?'核对实验发布':'发布实验';button=T.preview?'确认发布':'预览发布';
      if(T.preview){body=teachingPublishPreview();break}
      body=ts('version_id','实验内容版本',T.catalog.templates.flatMap(t=>t.versions.map(v=>[v.id,v.title+' · 版本 '+v.number])))+tf('title','任务名称（可选）')+'<label>发布到教学班</label><div class="target-list">'+(o?.classes||[]).map(c=>`<div class="target-row"><label class="class-choice"><input type="checkbox" data-list="class_ids" value="${c.id}" ${(f.class_ids||[]).includes(c.id)?'checked':''}>${E(c.name)}</label><select aria-label="${E(c.name)}分组" data-field="scheme_${c.id}"><option value="">为本任务新建分组</option>${c.schemes.map(s=>`<option value="${s.id}" ${f['scheme_'+c.id]===s.id?'selected':''}>复用：${E(s.name)}（${s.min_size}–${s.max_size}人）</option>`).join('')}</select></div>`).join('')+'</div><div class="extract-fields">'+tf('opens_at','开放时间（留空立即开放）','datetime-local')+tf('closes_at','实验截止（可选）','datetime-local')+'</div><details open><summary>新分组的设置</summary>'+ts('mode','分组方式',[['self','学生自主选组'],['assigned','教师安排 / 系统分配']])+'<div class="extract-fields">'+tf('min_size','最少人数','number')+tf('max_size','最多人数','number')+'</div>'+tf('selection_deadline','选组截止（留空采用实验截止）','datetime-local')+'<label class="class-choice"><input type="checkbox" data-field="allow_create" '+(f.allow_create?'checked':'')+'>允许学生创建小组</label></details>';break;
    case 'schedule':title='调整实验时间与状态';body=tf('opens_at','开放时间','datetime-local')+tf('closes_at','截止时间','datetime-local')+ts('status','任务状态',[['published','开放任务'],['closed','结束任务']])+'<p class="small muted">选组截止在班级与分组中单独调整；实验内容版本保持原引用。</p>';break;
    case 'team-create':title='建立小组';body=tf('name','小组名称','text','可填写组名，留空使用默认名称');break;
    case 'member':{
      title='调整小组成员';const team=teachingTeam(f.team_id),scheme=teachingScheme(team.scheme_id),cls=teachingClass(scheme.class_id);
      body='<p>当前成员：'+team.members.map(p=>E(p.name)).join('、')+'</p>'+ts('username','本教学班学生',cls.students.map(p=>[p.username,p.name+'（'+p.username+'）']))+ts('operation','操作',[['add','加入此组 / 从原组调入'],['remove','从此组移出']])+tf('reason','调整原因（实验开始后必填）','textarea');break;
    }
    case 'auto-assign':title='自动分配未选组学生';body='<p>系统将只分配当前方案中尚未选组的学生，按人数上下限建立新组。已有分组保留。</p>';button='确认分配';break;
    case 'scheme-deadline':title='调整选组截止';body='<p>同一分组方案可能被多个实验任务复用，此调整对使用该方案的任务生效。</p>'+tf('deadline','选组截止（留空不限制）','datetime-local');break;
    case 'team-leave':title='退出小组';body='<p>退出后可重新选择小组；开始实验后需由教师调整。</p>';button='确认退出';break;
    case 'enroll':
      title='加入教学班';button='加入班级';
      body=`<div class="field"><label for="tf-join_code">班级邀请码</label><input id="tf-join_code" data-field="join_code" type="text" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" placeholder="输入老师提供的 6 位数字" value="${E(f.join_code)}"></div>`;
      break;
  }
  return `<div class="overlay"><section class="dialog teaching-dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title"><div class="panelhead"><h2 id="dialog-title">${E(title)}</h2><button class="close" data-action="close" aria-label="关闭">${I('close')}</button></div>${body}${S.error?`<div class="error" role="alert">${E(S.error)}</div>`:''}<div class="actions dialog-actions">${B(button,'teaching-save','primary')}${T.preview?B('返回修改','publish-edit','btn'):B('取消','close','link')}</div></section></div>`;
}
function teachingPublishPreview(){
  const d=T.preview,v=T.catalog.templates.flatMap(t=>t.versions).find(v=>v.id===d.version_id);
  return `<div class="publish-review"><h3>${E(d.title||v?.title)}</h3><p>${E(teachingOffering()?.title)} · ${E(teachingOffering()?.term)}</p><p>内容版本：${E(v?.number)}</p><p>开放：${teachingWhen(d.opens_at)}<br>截止：${teachingWhen(d.closes_at)}</p>${d.class_ids.map(id=>{const s=teachingScheme(d.scheme_ids[id]);return `<div class="notice"><strong>${E(teachingClass(id)?.name)}</strong><br>${s?'复用 '+E(s.name)+' · '+s.min_size+'–'+s.max_size+' 人 / 组':'新分组 · '+d.min_size+'–'+d.max_size+' 人 / 组 · '+(d.mode==='self'?'学生自主选组':'教师安排')}<br>选组截止 ${teachingWhen(s?s.deadline:d.selection_deadline||d.closes_at)}</div>`}).join('')}${v?`<details class="handout-preview"><summary>预览学生看到的讲义</summary>${handoutMarkup(v.package)}</details>`:''}<p class="small muted">确认后向所选教学班发布，并固定引用这版讲义。</p></div>`;
}

function teachingReset(){
  if(S.raw.trim()&&current())stashText();
  S.gid=null;S.draft=null;S.raw='';S.conclusion='';S.message='';S.feedback='';S.assist=null;S.lastQuestion='';S.error='';S.assistTarget='';
}
async function teachingManage(action,data){return api('/teaching/'+action,command(data))}
async function teachingChange(event){
  const el=event.target;
  if(el.dataset.context){
    if(S.busy)return;
    capture();teachingReset();S.busy=true;
    try{
      if(el.dataset.context==='offering'){T.offeringId=el.value;T.assignmentId='';T.classId=''}
      if(el.dataset.context==='assignment'){T.assignmentId=el.value;T.classId=''}
      if(el.dataset.context==='class')T.classId=el.value;
      S.view=isTeacher()?'overview':'tasks';
      await refresh(false);teachingRemember();
    }catch(e){S.error=e.message}finally{S.busy=false;render()}
  }else if(['term_id','rule_type'].includes(el.dataset.field)){
    capture();render();
  }
}
async function teachingSave(){
  const f={...T.form},kind=T.dialog;
  let payload=f,action=kind;
  if(kind==='offering')payload={course_id:f.course_id,term_id:f.term_id,term_name:f.term_name};
  if(kind==='clone')payload={offering_id:f.offering_id,term_id:f.term_id,term_name:f.term_name};
  if(kind==='class')payload={offering_id:T.offeringId,name:f.name};
  if(kind==='roster')payload={class_id:f.class_id,usernames:(f.roster||'').split(/\r?\n/).map(x=>x.trim().split(/[,，\s]+/)[0].replace(/^["']|["']$/g,'')).filter(x=>x&&!['username','学号','账号'].includes(x.toLowerCase()))};
  if(kind==='template'||kind==='template-version'){
    const {handout_notes,handout_generated,steps_text,...fields}=f;
    payload={...fields,steps:(steps_text||'').split(/\r?\n/).map(x=>x.trim()).filter(Boolean)};
  }
  if(kind==='publish'){
    if(!T.preview){
      const ids=f.class_ids||[];if(!ids.length)throw new Error('请至少选择一个教学班');
      if(!Number.isInteger(Number(f.min_size))||!Number.isInteger(Number(f.max_size))||Number(f.min_size)<1||Number(f.max_size)>30||Number(f.min_size)>Number(f.max_size))throw new Error('组员人数须为1至30之间的整数，最少人数不能大于最多人数');
      T.preview={offering_id:T.offeringId,title:f.title||'',version_id:f.version_id,class_ids:ids,scheme_ids:Object.fromEntries(ids.map(id=>[id,f['scheme_'+id]||''])),min_size:Number(f.min_size),max_size:Number(f.max_size),mode:f.mode,allow_create:!!f.allow_create,opens_at:teachingDate(f.opens_at),closes_at:teachingDate(f.closes_at),selection_deadline:teachingDate(f.selection_deadline)};
      return;
    }
    payload=T.preview;
  }
  if(kind==='schedule')payload={assignment_id:f.assignment_id,status:f.status,opens_at:teachingDate(f.opens_at),closes_at:teachingDate(f.closes_at)};
  if(kind==='member')payload={team_id:f.team_id,username:f.username,remove:f.operation==='remove',reason:f.reason||''};
  if(kind==='scheme-deadline')payload={scheme_id:f.scheme_id,deadline:teachingDate(f.deadline)};
  if(kind==='collaborator')payload={offering_id:T.offeringId,username:f.username};
  if(kind==='enroll'){
    const code=(f.join_code||'').trim();
    if(!/^[0-9]{6}$/.test(code))throw new Error('请输入 6 位数字邀请码。');
    payload={join_code:code};
  }
  const result=await teachingManage(action,payload);
  S.modal=null;T.preview=null;T.form={};
  if(kind==='offering'||kind==='clone'){T.offeringId=result.id;T.assignmentId='';T.classId='';S.view='classes'}
  if(kind==='course'||kind==='archive')S.view='courses';
  if(kind.startsWith('template'))S.view='content';
  if(kind==='publish'){T.assignmentId=result.id;T.classId='';S.view='tasks'}
  if(kind==='enroll'){T.offeringId=result.offering_id;T.assignmentId='';T.classId='';S.view='tasks'}
  if(kind==='team-create'&&!isTeacher())S.view='lab';
  if(kind==='team-leave')S.view='teams';
  await refresh(false);teachingRemember();toast(kind==='publish'?'实验已发布，目标班级学生可见':'已保存');
}
async function teachingAction(name){
  const [a,v,extra]=name.split(':');
  if(a==='logout'){T.catalog=null;T.authMode='login';return false}
  if(a==='register-open'){T.authMode='register';T.form={};S.error='';return true}
  if(a==='register-cancel'){T.authMode='login';S.error='';return true}
  if(a==='read-handout'){
    const task=T.catalog?.assignments.find(assignment=>assignment.id===v);
    if(!task)throw new Error('未找到可查看的实验讲义。');
    S.handout=task.experiment;S.modal='instructions';return true;
  }
  if(a==='draft-handout'){
    if(!['template','template-version'].includes(T.dialog))return true;
    if(!T.form.handout_notes?.trim())throw new Error('请先填写备课要点。');
    toast('正在整理实验讲义草稿…');
    const {draft}=await api('/teaching/handout-draft',{notes:T.form.handout_notes});
    for(const key of ['title','subject','objective','principle','materials','preparation','safety','report_instructions','steps_text']){
      const value=key==='steps_text'?draft.steps.join('\n'):draft[key];
      if(!T.form[key]?.trim()&&value)T.form[key]=value;
    }
    T.form.handout_generated=true;return true;
  }
  if(a==='teaching-save'){await teachingSave();return true}
  if(a==='publish-edit'){T.preview=null;return true}
  if(a==='manage'){
    const defaults={};
    if(v==='offering'){
      if(!T.catalog.courses.length)throw new Error('请先创建课程');
      defaults.course_id=teachingOffering()?.course_id||T.catalog.courses[0].id;defaults.term_id=T.catalog.terms[0]?.id||'';
    }
    if(v==='publish'){
      if(!teachingOffering()?.classes.length)throw new Error('请先为当前开课建立教学班');
      const version=T.catalog.templates[0]?.versions[0];if(!version)throw new Error('请先创建实验内容');
      Object.assign(defaults,{version_id:version.id,class_ids:[],min_size:1,max_size:4,allow_create:true,mode:'self'});
    }
    if(v==='template')Object.assign(defaults,{title:'',subject:'',objective:'',steps_text:'',rule_type:'observation',r1_ohm:10000,r2_ohm:10000,supply_min_v:3.2,supply_max_v:3.4,tolerance_v:.05});
    teachingOpen(v,defaults);return true;
  }
  if(a==='open-course'){teachingOpen('offering',{course_id:v,term_id:T.catalog.terms[0]?.id||''});return true}
  if(a==='clone-offering'){teachingOpen('clone',{offering_id:v,term_id:''});return true}
  if(a==='archive-offering'){const o=T.catalog.offerings.find(o=>o.id===v);teachingOpen('archive',{offering_id:v,archived:!o.archived,label:o.term+' · '+o.title});return true}
  if(a==='add-roster'){teachingOpen('roster',{class_id:v});return true}
  if(a==='remove-student'){const p=teachingClass(v).students.find(p=>p.id===extra);teachingOpen('remove-student',{class_id:v,user_id:extra,label:p.name});return true}
  if(a==='edit-template'){const t=T.catalog.templates.find(t=>t.id===v),p=t.versions[0].package;teachingOpen('template-version',{...p,template_id:t.id,steps_text:p.steps.join('\n')});return true}
  if(a==='copy-template'){const t=T.catalog.templates.find(t=>t.id===v);teachingOpen('template-copy',{template_id:v,title:t.title+'副本'});return true}
  if(a==='publish-template'){await teachingAction('manage:publish');T.form.version_id=v;return true}
  if(a==='schedule'){const t=T.catalog.assignments.find(t=>t.id===v);teachingOpen('schedule',{assignment_id:v,opens_at:teachingLocal(t.opens_at),closes_at:teachingLocal(t.closes_at),status:t.status});return true}
  if(a==='teacher-team'||a==='student-team'){teachingOpen('team-create',{scheme_id:v});return true}
  if(a==='edit-members'){
    const team=teachingTeam(v),scheme=teachingScheme(team.scheme_id),c=teachingClass(scheme.class_id);
    teachingOpen('member',{team_id:v,operation:'add',username:c.students[0]?.username||''});return true;
  }
  if(a==='auto-assign'){teachingOpen('auto-assign',{scheme_id:v});return true}
  if(a==='scheme-deadline'){teachingOpen('scheme-deadline',{scheme_id:v,deadline:teachingLocal(teachingScheme(v).deadline)});return true}
  if(a==='leave-team'){teachingOpen('team-leave',{team_id:v});return true}
  if(a==='open-offering'){
    teachingReset();T.offeringId=v;T.assignmentId='';T.classId='';S.view=isTeacher()?'overview':'tasks';await refresh(false);teachingRemember();return true;
  }
  if(['open-assignment','assignment-groups','student-task','student-groups','student-enter'].includes(a)){
    const target=T.catalog.assignments.find(t=>t.id===v);teachingReset();T.offeringId=target.offering_id;T.assignmentId=v;T.classId='';
    if(a==='open-assignment')S.view='overview';
    else if(a==='assignment-groups')S.view='classes';
    else if(a==='student-enter')S.view='lab';
    else S.view=a==='student-task'&&target.my_runs.length?'lab':'teams';
    await refresh(false);teachingRemember();return true;
  }
  if(a==='join-team'||a==='solo-team'){
    await teachingManage(a==='join-team'?'team-join':'team-create',a==='join-team'?{team_id:v}:{scheme_id:v,name:S.data.user.name.slice(0,25)+'（'+S.data.user.username+'）'});
    S.view='lab';await refresh(false);toast('已加入实验小组');return true;
  }
  return false;
}
function teachingRegisterView(){
  return `<main class="auth-stage"><section class="auth-shell"><header class="x-head"><div class="x-brand"><span class="x-mark">${I('circuit')}</span>验知有道</div>${P('学生注册','blue')}</header><form id="register-form" class="auth-form"><h1>创建学生账号</h1><p class="muted auth-intro">注册后向教师获取班级邀请码，加入课程。</p>${tf('username','账号 / 学号','text','3至40位字母、数字或下划线等字符')}${tf('name','姓名')}${tf('password','密码（至少8位）','password')}${S.error?`<div class="error" role="alert">${E(S.error)}</div>`:''}<button class="primary wide" type="submit" ${S.busy?'disabled':''}>注册学生账号</button>${B('返回登录','register-cancel','link')}</form></section></main>`;
}
document.addEventListener('submit',async event=>{
  if(event.target.id!=='register-form')return;
  event.preventDefault();if(S.busy)return;capture();S.busy=true;S.error='';
  try{await api('/register',{username:T.form.username,name:T.form.name,password:T.form.password});S.loginUser=T.form.username;S.loginPassword=T.form.password;T.form={};T.authMode='login';toast('注册成功，请登录后加入教学班')}
  catch(e){S.error=e.network?'暂时无法连接服务，请稍后重试。':e.message}
  finally{S.busy=false;render()}
});
