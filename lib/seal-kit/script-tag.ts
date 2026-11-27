/**
 * Standalone browser entry. A tag with data-auto-seal installs an automatic seal and panel.
 * Keep it at the end of the application's required scripts and before protected data is opened.
 * The host application remains responsible for any worker or iframe contexts.
 */
import * as Neverheld from "./index";
type Global = typeof globalThis & { Neverheld?: typeof Neverheld };
(globalThis as Global).Neverheld = Neverheld;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, label?: string): HTMLElementTagNameMap[K] {
  const item=document.createElement(tag); if(label) item.textContent=label; return item;
}
function applyStyle(item: HTMLElement, style: Partial<CSSStyleDeclaration>) { Object.assign(item.style,style); }
function save(name:string,content:string,type:string) {
  const url=URL.createObjectURL(new Blob([content],{type}));
  const link=el("a"); link.href=url; link.download=name; link.click();
  window.setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function htmlEscape(value:string) {
  return value.replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c] as string));
}
function readable(proof:Neverheld.Proof) {
  const b=proof.body;
  const answers=b.controlAnswers.answers.map(a=>`<section><h2>${htmlEscape(a.name)}</h2><p><b>${htmlEscape(a.result)}</b> · ${htmlEscape(a.question)}</p><p>${htmlEscape(a.answer)}</p><p class="muted">${htmlEscape(a.limits)}</p></section>`).join("");
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>NEVERHELD proof</title><style>body{font:15px/1.55 system-ui,sans-serif;max-width:780px;margin:32px auto;padding:0 18px;color:#17202c}h1{font-size:24px}h2{font-size:17px}section{border-top:1px solid #ddd;padding:8px 0}.muted{color:#596574;font-size:13px}code{overflow-wrap:anywhere}.notice{padding:12px;background:#f2f4f7}</style><body>
<h1>NEVERHELD session proof</h1><p class="notice">Written by the page itself. This is evidence of what the page observed after sealing, not a signed record of the session or an independent audit.</p>
<p><b>Application:</b> ${htmlEscape(b.application.name)} ${htmlEscape(b.application.version)}<br><b>Release:</b> ${htmlEscape(b.release.id)}<br><b>Sealed:</b> ${htmlEscape(b.seal.sealedAt)} UTC</p>
<p><b>NOPE count:</b> ${b.seal.pageRequestsSinceSealing}<br><b>Blocked attempts:</b> ${b.seal.blockedAttemptsSinceSealing}<br><b>Self-test:</b> ${htmlEscape(b.seal.selfTest)}</p>
<h2>Files (fingerprints only)</h2><ul>${b.files.length?b.files.map(f=>`<li>${htmlEscape(f.name)} <code>${htmlEscape(f.sha256)}</code></li>`).join(""):"<li>No file fingerprints supplied by this one-tag installation.</li>"}</ul><h2>Control Answers</h2>${answers}
<h2>Limits</h2><ul>${b.limits.map(x=>`<li>${htmlEscape(x)}</li>`).join("")}</ul><p><b>Proof hash:</b><br><code>${proof.proofHash.value}</code></p>
<p class="muted">A hash in the same file is not proof against deliberate rewriting. The signed release authenticates released code, not the session.</p></body></html>`;
}
async function autoSeal(tag:HTMLScriptElement) {
  const gate=el("dialog");
  const heading=el("h2","NEVERHELD is sealing this page");
  const message=el("p","Do not open or enter customer data until the browser self-test passes.");
  const note=el("p","If the browser does not enforce the seal, this page will remain blocked.");
  applyStyle(gate,{width:"min(540px,calc(100vw - 36px))",border:"1px solid #cbd5e1",borderRadius:"14px",padding:"24px",font:"14px/1.5 system-ui,sans-serif",color:"#17202c"});
  gate.append(heading,message,note); document.documentElement.append(gate);
  if(typeof gate.showModal==="function") gate.showModal(); else {applyStyle(gate,{display:"block",position:"fixed",inset:"15% 5%",zIndex:"2147483647"});document.body.inert=true;}
  const releaseId=tag.dataset.releaseId||`neverheld-kit-${Neverheld.SEAL_KIT_VERSION}`;
  const app={name:tag.dataset.application||location.hostname||"Web application",version:tag.dataset.version||"not supplied",commit:tag.dataset.commit||"not supplied"};
  const workerDeclared=tag.dataset.workersNetwork==="configured";
  const workers={network:workerDeclared?"configured" as const:"not-declared" as const,description:workerDeclared?(tag.dataset.workersDescription||"Application owner declares worker network policies; this session did not test them."):"No application worker configuration supplied; worker isolation is not asserted."};
  let release:Neverheld.ReleaseInfo={id:releaseId,manifestSha256:null,manifestFiles:null};
  const update=(s:Neverheld.SealStatus)=>{
    if(s.state==="failed"){heading.textContent="NEVERHELD could not seal this page";message.textContent=s.error||"The browser did not confirm the seal.";note.textContent="Do not use this page for protected data. Refresh or contact the application owner.";}
    else if(s.state==="sealed"){heading.textContent="NEVERHELD seal active";message.textContent=`NOPE count: ${s.requests}. Blocked attempts: ${s.blocked}.`;note.textContent=s.requests===0?"No page network requests were observed after sealing. The self-test was refused.":"A page network request was observed. Treat this session as not supported.";}
  };
  const unsubscribe=Neverheld.subscribeToSeal(update);
  try{
    await Neverheld.sealPage(async()=>{if(tag.dataset.releaseManifestUrl) release=await Neverheld.fetchReleaseInfo(new URL(tag.dataset.releaseManifestUrl,location.href).toString(),releaseId);});
    gate.close();gate.remove();document.body.inert=false;
    const bar=el("div"),count=el("span","NEVERHELD · NOPE: 0"),open=el("button","Proof and checks");
    applyStyle(bar,{position:"fixed",top:"10px",right:"10px",zIndex:"2147483646",display:"flex",gap:"10px",alignItems:"center",background:"#102a24",color:"white",padding:"8px 12px",border:"1px solid #4e8e79",borderRadius:"10px",font:"12px system-ui,sans-serif",boxShadow:"0 4px 18px #0002"});
    applyStyle(open,{background:"white",color:"#102a24",border:"0",borderRadius:"6px",padding:"5px 8px",cursor:"pointer"});bar.append(count,open);document.body.append(bar);
    const panel=el("dialog"),title=el("h2","NEVERHELD session evidence"),desc=el("p"),caveat=el("p","This records this page after sealing. It does not cover activity before sealing, existing frames, service workers, extensions, other tabs or whole-tab navigation. Worker isolation is not asserted unless configured by the application.");
    const json=el("button","Download JSON proof"),html=el("button","Download readable proof"),verify=el("button","Open offline verifier"),close=el("button","Close");
    applyStyle(panel,{width:"min(650px,calc(100vw - 36px))",maxHeight:"80vh",overflow:"auto",border:"1px solid #cbd5e1",borderRadius:"14px",padding:"24px",font:"14px/1.5 system-ui,sans-serif",color:"#17202c"});
    for(const button of [json,html,verify,close]) applyStyle(button,{margin:"5px 8px 5px 0",padding:"8px 10px",border:"1px solid #94a3b8",borderRadius:"6px",cursor:"pointer"});
    panel.append(title,desc,caveat,json,html,verify,close);document.body.append(panel);
    const makeProof=()=>Neverheld.buildProof({status:Neverheld.getSealStatus(),files:[],application:app,release,workers});
    open.addEventListener("click",()=>{const s=Neverheld.getSealStatus();desc.textContent=`Sealed at ${s.sealedAtTime||s.sealedAtEpoch}; page requests ${s.requests}; blocked attempts ${s.blocked}; worker evidence: ${workers.network}.`;panel.showModal();});
    close.addEventListener("click",()=>panel.close());
    json.addEventListener("click",async()=>{try{const p=await makeProof();save("NEVERHELD-proof.json",Neverheld.proofJson(p),"application/json");}catch(e){desc.textContent=String(e);}});
    html.addEventListener("click",async()=>{try{const p=await makeProof();save("NEVERHELD-proof.html",readable(p),"text/html");}catch(e){desc.textContent=String(e);}});
    verify.addEventListener("click",()=>window.open(new URL("verify.html",tag.src||location.href).toString(),"_blank","noopener,noreferrer"));
    Neverheld.subscribeToSeal(s=>{count.textContent=`NEVERHELD · NOPE: ${s.requests} · Blocked: ${s.blocked}`;if(s.requests>0)bar.style.background="#7f1d1d";});
  }catch{update(Neverheld.getSealStatus());unsubscribe();}
}
const current=document.currentScript as HTMLScriptElement|null;
if(current?.hasAttribute("data-auto-seal")) void autoSeal(current);
