'use strict';

const R={data:null, sections:{}, reflection:'', feedback:'', scores:{}};
const reportFields={objective:'实验目的与原理',method:'实验方法与条件',analysis:'异常分析与讨论',conclusion:'实验结论'};

function dateOfReport(value){
  return new Date(value).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false});
}
function reportPath(gid,submissionId){
  const base='/groups/'+encodeURIComponent(gid)+'/report';
  return submissionId?`${base}?submission_id=${encodeURIComponent(submissionId)}`:base;
}
function reportPdfLinks(report,gid){
  if(!report?.formal)return '';
  const url='/api'+reportPath(gid)+'.pdf?submission_id='+encodeURIComponent(report.id);
  return `<div class="actions report-downloads"><a class="btn x-btn" href="${E(url)}" download>${I('file')}导出过程报告 PDF</a>${report.evaluation?.total!=null?`<a class="primary x-primary" href="${E(url)}&amp;reviewed=1" download>${I('file')}导出带评分和评语的 PDF</a>`:''}</div>`;
}
function setReport(data){
  R.data=data;R.sections={...data.sections};R.reflection=data.reflection||'';R.feedback='';R.scores={};
}
function captureReport(){
  if(!R.data||!['submit','report-review'].includes(S.view))return;
  for(const name of Object.keys(reportFields)){
    const el=$('#report-'+name);
    if(el&&!el.readOnly)R.sections[name]=el.value;
  }
  const reflection=$('#report-reflection'), feedback=$('#report-feedback');
  if(reflection&&!reflection.readOnly)R.reflection=reflection.value;
  if(feedback)R.feedback=feedback.value;
  for(const item of R.data.rubric){const el=$('#rubric-'+item.key);if(el)R.scores[item.key]=el.value}
}
function reportHasChanges(){
  if(!R.data)return false;
  return ((R.data.sections||R.data.reflection!=null)&&(R.reflection!==(R.data.reflection||'')||
    Object.keys(reportFields).some(key=>(R.sections[key]||'')!==(R.data.sections?.[key]||''))))||
    R.feedback.trim()||Object.values(R.scores).some(value=>value!=='');
}
async function refreshVisibleReport(isCurrent){
  if(!R.data||!['submit','report-review'].includes(S.view)||R.data.group_id!==current()?.id||R.data.status===current().status)return;
  captureReport();
  if(reportHasChanges())return;
  const existing=R.data;
  const selected=existing.submission?.id===existing.history.at(-1)?.id?null:existing.submission?.id;
  const updated=await api(reportPath(existing.group_id,selected)).catch(()=>null);
  if(updated&&isCurrent()&&R.data===existing&&['submit','report-review'].includes(S.view)&&!reportHasChanges())setReport(updated);
}

function reportHistory(report){
  if(!report.history.length)return '';
  return `<div class="report-history"><span class="small muted">提交记录</span><div class="actions">${report.history.map((item,i)=>B(`第 ${i+1} 次 · ${dateOfReport(item.created)}`,'report-history:'+item.id,report.submission?.id===item.id?'primary':'btn')).join('')}</div></div>`;
}
function reportEvidence(report,group){
  const identifiers=new Set(report?.evidence_ids||[]);
  const rows=group.events.filter(event=>identifiers.has(event.id));
  if(!rows.length)return '';
  return `<details class="panel report-evidence"><summary>提交关联的证据（${rows.length} 条）</summary>${rows.map(e=>`<article><div class="panelhead"><strong>${E(titleByKind[e.kind]||e.kind)} · ${E(e.id.slice(0,8))}</strong>${P('修订 '+e.revision)}</div>${eventBody(e)}</article>`).join('')}</details>`;
}
function reportEvaluation(evaluation){
  if(!evaluation)return '';
  return `<section class="panel"><div class="panelhead"><h2>教师反馈</h2>${P(evaluation.decision==='return'?'退回补充':'已反馈','blue')}</div><p class="small muted">${E(evaluation.author)} · ${E(dateOfReport(evaluation.created))}</p>${evaluation.total!=null?`<p class="report-total">${E(evaluation.total)} <small>/ ${E(evaluation.maximum)}</small></p><dl class="report-scores">${evaluation.scores.map(item=>`<div><dt>${E(item.label)}</dt><dd>${E(item.score)} / ${E(item.maximum)}</dd></div>`).join('')}</dl>`:''}<p class="answer-text">${E(evaluation.text)}</p></section>`;
}
function submittedSections(report){
  return `<section class="panel"><h2>小组报告</h2>${Object.entries(reportFields).map(([key,label])=>report.sections[key]?`<div class="report-entry"><h3>${label}</h3><p class="answer-text">${E(report.sections[key])}</p></div>`:'').join('')}</section>`;
}
function submittedReflections(report){
  return report.reflections?.length?`<section class="panel"><h2>${isTeacher()?'组员个人反思':'我的个人反思'}</h2>${report.reflections.map(item=>`<div class="report-entry"><h3>${E(item.name)}</h3><p class="answer-text">${E(item.text)}</p></div>`).join('')}</section>`:'';
}
function reportEditor(data){
  const progress=data.reflection_progress;
  return `<section class="panel"><div class="panelhead"><h2>小组报告草稿</h2>${P('小组共享','blue')}</div><p class="small muted">过程记录、照片及测量图表会在提交时关联。</p>
    ${Object.entries(reportFields).map(([key,label])=>`<div class="field"><label for="report-${key}">${label}${['method','conclusion'].includes(key)?'（必填）':''}</label><textarea id="report-${key}" maxlength="3000">${E(R.sections[key])}</textarea></div>`).join('')}
    ${B('保存小组草稿','report-save','btn')}
  </section><section class="panel"><div class="panelhead"><h2>我的个人反思</h2>${P(`${progress.completed} / ${progress.required} 人已保存`,'blue')}</div><p class="small muted">回顾整个实验：我做了什么、如何处理问题、学到了什么、下次怎样改进。内容仅本人和任课教师可见。</p><label class="sr-only" for="report-reflection">我的个人反思</label><textarea id="report-reflection" maxlength="4000">${E(R.reflection)}</textarea><div class="actions">${B('保存我的反思','report-reflect','btn')}</div></section>
  <p class="small muted">所有组员保存个人反思后，由一位组员提交小组报告。</p>${B('提交小组报告','report-submit','primary wide','send')}`;
}
function studentProcessReport(){
  const data=R.data,group=current();
  const selected=data.submission,latest=data.history.at(-1);
  const past=selected&&selected.id!==latest?.id;
  return `${B('返回实验','view:lab','link','back')}<div class="row"><h1>实验过程报告</h1>${P(statusLabels[group.status],'blue')}</div><p class="small muted">${E(S.data.assignment?.title||S.data.course.experiment.title)} · ${E(group.name)}</p>
    ${reportHistory(data)}${B('读取最新草稿与反馈','report-reload','link','refresh')}
    ${selected?reportEvaluation(selected.evaluation)+reportPdfLinks(selected,group.id):''}
    ${!past&&!locked(group)?reportEditor(data)+(selected?`<details class="panel"><summary>查看上次提交</summary>${submittedSections(selected)}${submittedReflections(selected)}${reportEvidence(selected,group)}</details>`:''):
      selected?submittedSections(selected)+submittedReflections(selected)+reportEvidence(selected,group):'<div class="notice">当前任务尚无可查看的报告提交。</div>'}`;
}
function teacherProcessReport(){
  const data=R.data,group=current(),selected=data?.submission;
  if(!selected||data.group_id!==group?.id)return `<section class="panel empty"><p>此小组尚未提交实验过程报告。</p>${B('返回实验提交','view:reports','link')}</section>`;
  const pending=selected.formal&&group.status==='submitted'&&data.history.at(-1)?.id===selected.id;
  return `${B('返回实验提交','view:reports','link','back')}${heading('实验过程报告',`${S.data.assignment?.title||S.data.course.experiment.title} · ${group.name}`,P(statusLabels[group.status],'blue'))}
    ${reportHistory(data)}${submittedSections(selected)}${submittedReflections(selected)}${reportEvidence(selected,group)}${reportEvaluation(selected.evaluation)}${reportPdfLinks(selected,group.id)}
    ${pending?`<section class="panel"><div class="panelhead"><h2>教师评阅</h2>${S.data.model_configured?B('AI 起草评语','report-draft-feedback','link','spark'):''}</div><div class="extract-fields">${data.rubric.map(item=>`<div class="field"><label for="rubric-${item.key}">${E(item.label)}（满分 ${item.maximum}）</label><input id="rubric-${item.key}" type="number" min="0" max="${item.maximum}" step="1" inputmode="numeric" value="${E(R.scores[item.key])}"></div>`).join('')}</div><div class="field"><label for="report-feedback">教师意见</label><textarea id="report-feedback" maxlength="3000">${E(R.feedback)}</textarea></div><div class="actions">${B('发布评分与评语','report-review:feedback','primary')}${B('退回补充','report-review:return','btn')}</div></section>`:''}`;
}

async function reportAction(name){
  if(name==='logout'){R.data=null;R.sections={};R.reflection='';R.feedback='';R.scores={};return false}
  if(!S.data?.report_enabled)return false;
  const [action,value]=name.split(':');
  if((action==='view'&&value==='submit'&&!isTeacher()&&current())||action==='open-report'){
    const gid=action==='open-report'?value:current().id;
    if(R.data?.group_id===gid&&reportHasChanges()&&!isTeacher()&&R.data.status===current()?.status){
      navigateStudent('submit');return true;
    }
    setReport(await api(reportPath(gid)));
    S.gid=gid;S.assist=null;
    if(isTeacher())S.view='report-review';else navigateStudent('submit');
    return true;
  }
  if(!['report-history','report-reload','report-save','report-reflect','report-submit','report-review','report-draft-feedback'].includes(action))return false;
  if(!R.data||R.data.group_id!==current()?.id)throw new Error('请从当前实验重新打开报告。');
  const data=R.data,path=reportPath(data.group_id);
  if(action==='report-history'||action==='report-reload'){
    if(reportHasChanges()&&!window.confirm('当前有尚未保存的输入。要读取服务器上的报告吗？'))return true;
    setReport(await api(reportPath(data.group_id,action==='report-history'?value:null)));
    return true;
  }
  if(action==='report-draft-feedback'){
    if(R.feedback.trim()&&!window.confirm('已有教师意见草稿。要用 AI 生成的新草稿替换吗？'))return true;
    const answer=await getAssist('请起草给本组实验报告的评语，仅依据已提交的结论和过程记录，说明一项优点和一项改进；不要给分。',data.group_id);
    R.feedback=answer.text;return true;
  }
  if(action==='report-review'){
    if(!R.feedback.trim())throw new Error('请先填写教师意见。');
    const payload={decision:value,submission_id:data.submission.id,text:R.feedback};
    if(value==='feedback'){
      payload.scores={};
      for(const item of data.rubric){
        const raw=R.scores[item.key]||'';
        if(!/^\d+$/.test(raw)||Number(raw)>item.maximum)throw new Error(`${item.label}须填写 0 至 ${item.maximum} 的整数。`);
        payload.scores[item.key]=Number(raw);
      }
    }
    await api('/groups/'+data.group_id+'/review',command(payload));
    setReport(await api(path));await refresh(false);toast(value==='return'?'已退回小组补充':'评分和评语已发布');return true;
  }
  const revision=current().revision;
  if(action==='report-save'){
    const saved=await api(path+'/draft',command({revision,draft_edit:data.draft_edit,sections:R.sections}));
    data.draft_edit=saved.edit;data.sections=saved.sections;R.sections={...saved.sections};toast('小组草稿已保存');return true;
  }
  if(action==='report-reflect'){
    if(!R.reflection.trim())throw new Error('请先填写个人反思。');
    const saved=await api(path+'/reflection',command({revision,reflection_edit:data.reflection_edit,reflection:R.reflection}));
    data.reflection_edit=saved.edit;
    if(!data.reflection) data.reflection_progress.completed++;
    data.reflection=R.reflection=R.reflection.trim();toast('个人反思已保存');return true;
  }
  await api(path+'/submit',command({revision,draft_edit:data.draft_edit,sections:R.sections,
                                  reflection_edit:data.reflection_edit,reflection:R.reflection}));
  setReport(await api(path));await refresh(false);toast('实验过程报告已提交，等待评阅');return true;
}
