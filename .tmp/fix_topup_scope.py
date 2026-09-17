from pathlib import Path
import re

p=Path('src/billing/routes.ts')
s=p.read_text()
marker='\n\nexport async function registerBillingRoutes(app:FastifyInstance):Promise<void>{'
if marker not in s:
    raise SystemExit('registerBillingRoutes marker missing')
helper='''

function topupSection(cookieHeader:string|undefined):string{
  return `<section class="card topup-card"><h2>Need more units?</h2><p class="muted">Active Basic and Pro subscribers can add extra units anytime. Purchased units do not expire; if you cancel, they stay on the account and unlock again when you resubscribe.</p><div class="topup-grid"><div class="topup-option"><strong>+500 units</strong><span>US$3.99 · one-time</span><form method="post" action="/billing/topup">${csrfField(cookieHeader)}<input type="hidden" name="pack" value="500"><button class="primary">Add 500 units</button></form></div><div class="topup-option"><strong>+1,500 units</strong><span>US$8.99 · one-time</span><form method="post" action="/billing/topup">${csrfField(cookieHeader)}<input type="hidden" name="pack" value="1500"><button>Add 1,500 units</button></form></div></div><p class="fine"><strong>No automatic overage charges.</strong> Expiring Founding bonus is consumed before your persistent paid balance.</p></section>`;
}

export async function registerBillingRoutes(app:FastifyInstance):Promise<void>{'''
s=s.replace(marker,helper,1)
s,n=re.subn(r'\n    const topupSection=\(cookieHeader:string\|undefined\)=>`[^\n]*`;\n','\n',s,count=1)
if n!=1:
    raise SystemExit(f'expected one local topupSection, found {n}')
p.write_text(s)
