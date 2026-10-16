import {readFileSync,writeFileSync,mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
// Run explicitly after reviewing web/index.html. Publishes only the invitation page.
const repo='mattwms76/Circles',branch='codex/invitation-pages';
const directory=mkdtempSync(join(tmpdir(),'circles-pages-'));
let sequence=0;
function api(path,method='GET',body){const args=['api',`repos/${repo}/${path}`,'--method',method];if(body){const file=join(directory,`${++sequence}.json`);writeFileSync(file,JSON.stringify(body));args.push('--input',file);}return JSON.parse(execFileSync('gh',args,{encoding:'utf8',windowsHide:true}));}
let parent;
try{parent=api(`git/ref/heads/${branch}`).object.sha;}catch(e){if(!String(e.stderr).includes('404'))throw e;}
const html=readFileSync(new URL('../web/index.html',import.meta.url),'utf8');
if(/sb_secret_|service_role/.test(html))throw Error('Server credentials must never be published.');
const tree=api('git/trees','POST',{tree:[{path:'index.html',mode:'100644',type:'blob',content:html},{path:'.nojekyll',mode:'100644',type:'blob',content:''}]});
const commit=api('git/commits','POST',{message:'Publish Circles invitation landing page',tree:tree.sha,parents:parent?[parent]:[]});
if(parent)api(`git/refs/heads/${branch}`,'PATCH',{sha:commit.sha,force:false});
else api('git/refs','POST',{ref:`refs/heads/${branch}`,sha:commit.sha});
let pages;
try{pages=api('pages');if(pages.source?.branch!==branch)throw Error('GitHub Pages already uses another source. Review its configuration before changing it.');}
catch(e){if(!String(e.stderr).includes('404'))throw e;pages=api('pages','POST',{build_type:'legacy',source:{branch,path:'/'}});}
console.log(JSON.stringify({url:pages.html_url,branch,commit:commit.sha,status:pages.status}));
