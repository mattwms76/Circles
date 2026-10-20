#!/usr/bin/env python3
"""Read-only Circles visual audit. Never logs in, mocks identity, or changes app data."""
import argparse
import asyncio
import json
import os
import shutil
from pathlib import Path
from playwright.async_api import async_playwright

ROUTES = [
    ('home', '/'), ('discover', '/discover'), ('circles', '/circles'),
    ('circle-detail', '/circle/3'), ('messages', '/messages'),
    ('conversation', '/chat/0'), ('profile', '/profile'),
    ('creator-profile', '/person/1'), ('compose', '/create'),
    ('live-lobby', '/live'), ('live-session', '/live/0'),
    ('oauth-callback', '/oauth/callback'),
]
VIEWPORTS = [('small', 320, 740), ('mobile', 390, 844), ('tablet', 768, 1024), ('wide', 1440, 1000)]
METRICS = """() => {
 const visible = e => { const r=e.getBoundingClientRect(); const s=getComputedStyle(e); return r.width>0&&r.height>0&&r.bottom>0&&r.top<innerHeight&&s.visibility!=='hidden'&&s.display!=='none'; };
 const leaves=[...document.querySelectorAll('div,span,p,button,input,textarea')].filter(e=>visible(e)&&!e.children.length&&((e.textContent||'').trim()||e.matches('input,textarea')));
 const items=leaves.map(e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return {text:(e.textContent||e.getAttribute('placeholder')||'').trim().slice(0,120),x:Math.round(r.x),y:Math.round(r.y),width:Math.round(r.width),height:Math.round(r.height),fontSize:parseFloat(s.fontSize),lineHeight:s.lineHeight,overflowX:s.overflowX};});
 const outside=items.filter(e=>e.x < -1 || e.x+e.width>innerWidth+1);
 const buttons=[...document.querySelectorAll('[role=button],button,input,textarea')].filter(visible).map(e=>{const r=e.getBoundingClientRect();return {label:e.getAttribute('aria-label')||(e.textContent||'').trim().slice(0,60),width:Math.round(r.width),height:Math.round(r.height)};});
 return {viewport:{width:innerWidth,height:innerHeight},documentWidth:document.documentElement.scrollWidth,visibleText:items,offscreenText:outside,controls:buttons,bodyText:document.body.innerText.slice(0,12000)};
}"""

async def main():
    args=argparse.ArgumentParser()
    args.add_argument('--output',default='/home/ubuntu/circles/design-audit/before')
    args.add_argument('--base',default=os.environ.get('EXPO_WEB_PREVIEW_URL') or 'http://127.0.0.1:8081')
    args.add_argument('--routes',default='')
    args.add_argument('--viewports',default='')
    args.add_argument('--measure-only',action='store_true')
    options=args.parse_args()
    out=Path(options.output);out.mkdir(parents=True,exist_ok=True)
    routes=[r for r in ROUTES if not options.routes or r[0] in options.routes.split(',')]
    sizes=[s for s in VIEWPORTS if not options.viewports or s[0] in options.viewports.split(',')]
    async with async_playwright() as p:
        candidates=[shutil.which('chromium'),shutil.which('chromium-browser'),shutil.which('google-chrome'),'/opt/google/chrome/chrome',p.chromium.executable_path]
        executable=next((x for x in candidates if x and Path(x).exists()),None)
        if not executable: raise RuntimeError('No Chromium executable is available for the requested viewport audit.')
        browser=await p.chromium.launch(executable_path=executable,headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
        context=await browser.new_context(ignore_https_errors=True,reduced_motion='reduce')
        page=await context.new_page()
        results=[]
        for name,width,height in sizes:
            await page.set_viewport_size({'width':width,'height':height})
            for route_id,path in routes:
                errors=[]
                def save_error(error): errors.append(str(error))
                page.on('pageerror',save_error)
                try:
                    await page.goto(options.base+path,wait_until='domcontentloaded',timeout=60000)
                    await page.wait_for_timeout(1000 if options.measure_only else 1700)
                    if not options.measure_only:
                        await page.screenshot(path=str(out/f'{route_id}-{name}.png'),full_page=True)
                    data=await page.evaluate(METRICS)
                    data.update({'id':route_id,'path':path,'size':name,'errors':errors,'screenshot':str(out/f'{route_id}-{name}.png')})
                    results.append(data)
                    print(f'Captured {route_id} {width}x{height}; document width {data["documentWidth"]}',flush=True)
                    if route_id in ('home','discover','circles','circle-detail','creator-profile'):
                        data['scrollEvidence']=await page.evaluate(r"""() => {
                          const candidates=[...document.querySelectorAll('div')].filter(e=>{const s=getComputedStyle(e),r=e.getBoundingClientRect();return ['auto','scroll'].includes(s.overflowY)&&e.scrollHeight>e.clientHeight+2&&r.width>150&&r.height>100;});
                          const target=candidates.sort((a,b)=>{const x=a.getBoundingClientRect(),y=b.getBoundingClientRect();return y.width*y.height-x.width*x.height;})[0];
                          if(!target)return {scrollable:false};
                          target.scrollTop=target.scrollHeight;
                          const r=target.getBoundingClientRect();
                          const labels=['Home','Discover','Circles','Chats','You'];
                          const tab=[...document.querySelectorAll('[role=tab]')].find(e=>labels.includes(e.textContent.replace(/[\uE000-\uF8FF]/g,'').replace(/\s+/g,' ').trim())&&e.getBoundingClientRect().top>innerHeight-110);
                          const bar=tab?.parentElement?.getBoundingClientRect();
                          return {scrollable:true,scrollTop:target.scrollTop,scrollHeight:target.scrollHeight,clientHeight:target.clientHeight,scrollBottom:r.bottom,hasBottomTabs:!!bar,tabTop:bar?.top,tabOverlap:bar?Math.max(0,r.bottom-bar.top):0};
                        }""")
                        await page.wait_for_timeout(120)
                        if not options.measure_only:
                            await page.screenshot(path=str(out/f'{route_id}-{name}-bottom.png'),full_page=True)
                    if route_id=='profile' and not options.measure_only:
                        sign_in=page.get_by_text('Make yourself at home',exact=True)
                        if await sign_in.count():
                            await sign_in.click();await page.wait_for_timeout(200)
                            await page.screenshot(path=str(out/f'login-overlay-{name}.png'),full_page=True)
                except Exception as error:
                    results.append({'id':route_id,'path':path,'size':name,'error':str(error)})
                    print(f'Capture error for {route_id}/{name}: {error}',flush=True)
                finally:
                    page.remove_listener('pageerror',save_error)
                (out/'metrics.json').write_text(json.dumps(results,indent=2))
        await browser.close()
        print(f'Audit capture complete: {len(results)} route/viewport views.',flush=True)

if __name__=='__main__': asyncio.run(main())
