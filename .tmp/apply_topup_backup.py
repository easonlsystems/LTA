from pathlib import Path
import json


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    s = p.read_text()
    if old not in s:
        raise SystemExit(f"anchor missing in {path}: {old[:160]!r}")
    p.write_text(s.replace(old, new, 1))


replace_once(
    "src/config/env.ts",
    "  LEMONSQUEEZY_PRO_VARIANT_ID: z.string().optional(),\n  LEMONSQUEEZY_TEST_MODE: boolish,",
    "  LEMONSQUEEZY_PRO_VARIANT_ID: z.string().optional(),\n  LEMONSQUEEZY_TOPUP_500_VARIANT_ID: z.string().optional(),\n  LEMONSQUEEZY_TOPUP_1500_VARIANT_ID: z.string().optional(),\n  LEMONSQUEEZY_TEST_MODE: boolish,",
)

replace_once(
    "src/billing/lemon.ts",
    "export type PaidPlan = 'basic' | 'pro';\n",
    """export type PaidPlan = 'basic' | 'pro';
export type TopupPack = '500' | '1500';

const TOPUP_UNITS:Record<TopupPack,number>={500:500,1500:1500};
function topupVariantId(pack:TopupPack):string|undefined{
  return pack==='500'?env().LEMONSQUEEZY_TOPUP_500_VARIANT_ID:env().LEMONSQUEEZY_TOPUP_1500_VARIANT_ID;
}
function topupPackFromVariant(variantIdRaw:unknown):TopupPack|null{
  const id=String(variantIdRaw??'');
  if(env().LEMONSQUEEZY_TOPUP_500_VARIANT_ID&&id===String(env().LEMONSQUEEZY_TOPUP_500_VARIANT_ID))return '500';
  if(env().LEMONSQUEEZY_TOPUP_1500_VARIANT_ID&&id===String(env().LEMONSQUEEZY_TOPUP_1500_VARIANT_ID))return '1500';
  return null;
}

export async function canPurchaseTopup(userId:string):Promise<boolean>{
  const r=await pool.query(`SELECT 1 FROM subscriptions WHERE user_id=$1 AND provider='lemonsqueezy' AND status IN ('active','trialing') LIMIT 1`,[userId]);
  return Boolean(r.rowCount);
}
""",
)

insert_topup = r"""
export async function createTopupCheckoutSession(userId:string,pack:TopupPack):Promise<string>{
  const variant=topupVariantId(pack);
  const storeId=env().LEMONSQUEEZY_STORE_ID;
  if(!env().LEMONSQUEEZY_API_KEY||!variant||!storeId)throw new Link2AIError('INTERNAL_ERROR','Top-up billing is not configured yet.',503);
  if(!await canPurchaseTopup(userId))throw new Link2AIError('AUTH_REQUIRED','An active Basic or Pro subscription is required to buy extra units.',403);
  const user=await pool.query<{email:string|null}>('SELECT email FROM users WHERE id=$1',[userId]);
  if(!user.rowCount)throw new Link2AIError('AUTH_REQUIRED','User not found.',401);
  const redirect=new URL('/billing/topup/success',env().PUBLIC_BASE_URL);
  redirect.searchParams.set('pack',pack);
  const response=await lemonRequest('POST','/checkouts',{
    data:{
      type:'checkouts',
      attributes:{
        product_options:{redirect_url:redirect.toString(),enabled_variants:[Number(variant)]},
        checkout_options:{embed:false,media:false,logo:true,desc:false,discount:false,skip_trial:true,subscription_preview:false},
        checkout_data:{
          ...(user.rows[0].email?{email:user.rows[0].email}:{}),
          custom:{user_id:userId,purpose:'topup',topup_pack:pack,units:String(TOPUP_UNITS[pack])}
        },
        test_mode:env().LEMONSQUEEZY_TEST_MODE
      },
      relationships:{
        store:{data:{type:'stores',id:String(storeId)}},
        variant:{data:{type:'variants',id:String(variant)}}
      }
    }
  });
  const url=response?.data?.attributes?.url;
  if(!url)throw new Link2AIError('INTERNAL_ERROR','Billing provider did not return a top-up checkout URL.',502);
  return String(url);
}

"""
replace_once(
    "src/billing/lemon.ts",
    "export function verifyLemonSignature(rawBody:string,signatureHeader:string):boolean{",
    insert_topup + "export function verifyLemonSignature(rawBody:string,signatureHeader:string):boolean{",
)

topup_processor = r"""
async function processTopupOrderEvent(eventName:string,event:any,obj:any):Promise<boolean>{
  if(obj?.type!=='orders')return false;
  const custom=event?.meta?.custom_data??{};
  if(String(custom.purpose??'')!=='topup')return false;
  const attrs=obj.attributes??{};
  if(typeof attrs.test_mode==='boolean'&&attrs.test_mode!==env().LEMONSQUEEZY_TEST_MODE)return true;
  const requestedPack=custom.topup_pack==='1500'?'1500':custom.topup_pack==='500'?'500':null;
  const variantPack=topupPackFromVariant(attrs?.first_order_item?.variant_id);
  if(!requestedPack||variantPack!==requestedPack)return true;
  const userId=String(custom.user_id??'');
  const orderId=String(obj.id??'');
  if(!userId||!orderId)return true;
  const units=TOPUP_UNITS[requestedPack];
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 510215))`,[`topup:${orderId}`]);
    if(eventName==='order_created'){
      if(String(attrs.status??'')!=='paid'){await client.query('COMMIT');return true;}
      const exists=await client.query('SELECT 1 FROM users WHERE id=$1',[userId]);
      if(!exists.rowCount){await client.query('COMMIT');return true;}
      const totalCents=Math.max(0,Number(attrs.total??0)||0);
      const inserted=await client.query<{id:string}>(
        `INSERT INTO paid_unit_transactions(user_id,kind,units_delta,source_key,provider,provider_reference_id,provider_total_cents,details)
         VALUES($1,'topup_purchase',$2,$3,'lemonsqueezy',$4,$5,$6::jsonb)
         ON CONFLICT(source_key) DO NOTHING RETURNING id`,
        [userId,units,`lemonsqueezy:order:${orderId}`,orderId,totalCents,JSON.stringify({pack:requestedPack,variant_id:String(attrs?.first_order_item?.variant_id??'')})]
      );
      if(inserted.rowCount){
        await client.query(`UPDATE users SET paid_rollover_seconds=paid_rollover_seconds+$2,updated_at=now() WHERE id=$1`,[userId,units*60]);
      }
      await client.query('COMMIT');
      return true;
    }
    if(eventName==='order_refunded'){
      const purchase=await client.query<{id:string;units_delta:number;provider_total_cents:number;provider_refunded_cents:number}>(
        `SELECT id,units_delta,provider_total_cents,provider_refunded_cents FROM paid_unit_transactions
         WHERE source_key=$1 AND kind='topup_purchase' FOR UPDATE`,[`lemonsqueezy:order:${orderId}`]
      );
      if(!purchase.rowCount){await client.query('COMMIT');return true;}
      const row=purchase.rows[0];
      const total=Math.max(1,Number(row.provider_total_cents??0)||Number(attrs.total??0)||1);
      const previousRefund=Math.max(0,Number(row.provider_refunded_cents??0)||0);
      const currentRefund=Math.max(previousRefund,Math.min(total,Math.max(0,Number(attrs.refunded_amount??0)||0)));
      const purchasedUnits=Math.max(0,Number(row.units_delta??units)||units);
      const previousUnits=Math.min(purchasedUnits,Math.round(purchasedUnits*previousRefund/total));
      const targetUnits=Math.min(purchasedUnits,Math.round(purchasedUnits*currentRefund/total));
      const deltaUnits=Math.max(0,targetUnits-previousUnits);
      if(deltaUnits>0){
        await client.query(`UPDATE users SET paid_rollover_seconds=GREATEST(0,paid_rollover_seconds-$2),updated_at=now() WHERE id=$1`,[userId,deltaUnits*60]);
        await client.query(
          `INSERT INTO paid_unit_transactions(user_id,kind,units_delta,source_key,provider,provider_reference_id,provider_total_cents,provider_refunded_cents,details)
           VALUES($1,'topup_refund',$2,$3,'lemonsqueezy',$4,$5,$6,$7::jsonb) ON CONFLICT(source_key) DO NOTHING`,
          [userId,-deltaUnits,`lemonsqueezy:order:${orderId}:refund:${currentRefund}`,orderId,total,currentRefund,JSON.stringify({pack:requestedPack,cumulative_refunded_cents:currentRefund})]
        );
      }
      await client.query(`UPDATE paid_unit_transactions SET provider_refunded_cents=$2 WHERE id=$1`,[row.id,currentRefund]);
      await client.query('COMMIT');
      return true;
    }
    await client.query('COMMIT');
    return true;
  }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}finally{client.release();}
}

"""
replace_once(
    "src/billing/lemon.ts",
    "export async function processLemonEvent(event:any):Promise<void>{",
    topup_processor + "export async function processLemonEvent(event:any):Promise<void>{",
)
replace_once(
    "src/billing/lemon.ts",
    "  if(!eventName||!obj?.id)return;\n  if(eventName==='order_refunded'&&obj?.type==='orders'){",
    "  if(!eventName||!obj?.id)return;\n  if(await processTopupOrderEvent(eventName,event,obj))return;\n  if(eventName==='order_refunded'&&obj?.type==='orders'){",
)
replace_once(
    "src/billing/lemon.ts",
    "    );\n    await reconcileFoundingOffer(client,{userId,plan,status,periodStart:period.start,firstSubscription});",
    """    );
    if(period.start&&(status==='active'||status==='trialing')){
      const grantUnits=Math.floor(PLAN_LIMITS[plan].secondsPerPeriod/60);
      await client.query(
        `INSERT INTO paid_unit_transactions(user_id,kind,units_delta,source_key,provider,provider_reference_id,details)
         VALUES($1,'subscription_grant',$2,$3,'lemonsqueezy',$4,$5::jsonb) ON CONFLICT(source_key) DO NOTHING`,
        [userId,grantUnits,`lemonsqueezy:subscription:${subscriptionId}:${period.start.toISOString()}`,subscriptionId,JSON.stringify({plan,period_start:period.start.toISOString()})]
      );
    }
    await reconcileFoundingOffer(client,{userId,plan,status,periodStart:period.start,firstSubscription});""",
)

replace_once(
    "src/billing/routes.ts",
    "import { createBillingPortalSession, createCheckoutSession, processLemonEvent, verifyLemonSignature, type PaidPlan } from './lemon.js';",
    "import { canPurchaseTopup, createBillingPortalSession, createCheckoutSession, createTopupCheckoutSession, processLemonEvent, verifyLemonSignature, type PaidPlan, type TopupPack } from './lemon.js';",
)
replace_once(
    "src/billing/routes.ts",
    ".public-cta{display:flex;gap:10px;flex-wrap:wrap;margin-top:22px}",
    ".public-cta{display:flex;gap:10px;flex-wrap:wrap;margin-top:22px}.topup-card{margin-top:16px}.topup-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin-top:14px}.topup-option{border:1px solid var(--line);border-radius:14px;padding:14px;background:#fff}.topup-option strong{display:block;font-size:18px;margin-bottom:3px}.topup-option span{font-size:12px;color:var(--muted)}.topup-option form{margin-top:10px}.topup-option button{width:100%}",
)
replace_once(
    "src/billing/routes.ts",
    "@media(max-width:760px){.plan-grid,.usage-rule,.usage-examples{grid-template-columns:1fr}.toplinks{display:none}}",
    "@media(max-width:760px){.plan-grid,.usage-rule,.usage-examples,.topup-grid{grid-template-columns:1fr}.toplinks{display:none}}",
)
replace_once(
    "src/billing/routes.ts",
    "    const topbar=(email?:string|null)=>`<div class=\"topbar\"><div class=\"brand\"><a href=\"/\"><img src=\"/logo.svg\" alt=\"\"><span>${esc(env().PUBLIC_BRAND_NAME)}</span></a></div>${email?`<div class=\"email\">${esc(email)}</div>`:`<div class=\"toplinks\"><a href=\"/\">Home</a><a href=\"/#supported\">Supported links</a><a href=\"/support\">Support</a></div>`}</div>`;",
    """    const topbar=(email?:string|null)=>`<div class="topbar"><div class="brand"><a href="/"><img src="/logo.svg" alt=""><span>${esc(env().PUBLIC_BRAND_NAME)}</span></a></div>${email?`<div class="email">${esc(email)}</div>`:`<div class="toplinks"><a href="/">Home</a><a href="/#supported">Supported links</a><a href="/support">Support</a></div>`}</div>`;
    const topupSection=(cookieHeader:string|undefined)=>`<section class="card topup-card"><h2>Need more units?</h2><p class="muted">Active Basic and Pro subscribers can add extra units anytime. Purchased units do not expire; if you cancel, they stay on the account and unlock again when you resubscribe.</p><div class="topup-grid"><div class="topup-option"><strong>+500 units</strong><span>US$3.99 · one-time</span><form method="post" action="/billing/topup">${csrfField(cookieHeader)}<input type="hidden" name="pack" value="500"><button class="primary">Add 500 units</button></form></div><div class="topup-option"><strong>+1,500 units</strong><span>US$8.99 · one-time</span><form method="post" action="/billing/topup">${csrfField(cookieHeader)}<input type="hidden" name="pack" value="1500"><button>Add 1,500 units</button></form></div></div><p class="fine"><strong>No automatic overage charges.</strong> Expiring Founding bonus is consumed before your persistent paid balance.</p></section>`;""",
)

pricing_anchor = "    return reply.type('text/html').send(page(`${topbar(user.email)}<section class=\"hero\"><span class=\"eyebrow\">Upgrade</span><div class=\"pricing-intro\"><h1>Pick based on processing capacity and concurrency — not content type or video length.</h1><p class=\"muted\">Basic and Pro read the same supported content types. Pro mainly gives you more units each billing cycle and higher concurrency. Unused paid units roll over while your paid subscription stays active.</p></div>${plans('checkout')}<p class=\"plan-note\">Only successfully processed content consumes usage. Unsupported, inaccessible, login-required, empty or failed reads use 0 processing units. You can manage or cancel a paid subscription from your account.</p></section>`,`${esc(env().PUBLIC_BRAND_NAME)} Pricing`));"
replace_once(
    "src/billing/routes.ts",
    pricing_anchor,
    "    const topupEligible=await canPurchaseTopup(user.id);\n    return reply.type('text/html').send(page(`${topbar(user.email)}<section class=\"hero\"><span class=\"eyebrow\">Upgrade</span><div class=\"pricing-intro\"><h1>Pick based on processing capacity and concurrency — not content type or video length.</h1><p class=\"muted\">Basic and Pro read the same supported content types. Pro mainly gives you more units each billing cycle and higher concurrency. Unused paid units roll over while your paid subscription stays active.</p></div>${plans('checkout')}<p class=\"plan-note\">Only successfully processed content consumes usage. Unsupported, inaccessible, login-required, empty or failed reads use 0 processing units. You can manage or cancel a paid subscription from your account.</p></section>${topupEligible?topupSection(req.headers.cookie):''}`,`${esc(env().PUBLIC_BRAND_NAME)} Pricing`));",
)
replace_once(
    "src/billing/routes.ts",
    "  app.get('/billing/success',async(req,reply)=>{",
    """  app.post('/billing/topup',async(req,reply)=>{
    const user=await requireWebUser(req,reply,'/account'); if(!user)return;
    const b=req.body as any;
    if(!verifyCsrfToken(req.headers.cookie,String(b?.csrf??'')))return reply.code(403).type('text/html').send(page(`<h1>${esc(env().PUBLIC_BRAND_NAME)}</h1><p>This top-up action expired. Please try again.</p><p><a href="/account">Back</a></p>`));
    const pack:TopupPack=b?.pack==='1500'?'1500':'500';
    try{return reply.redirect(await createTopupCheckoutSession(user.id,pack));}
    catch(e){return reply.code(400).type('text/html').send(page(`<h1>${esc(env().PUBLIC_BRAND_NAME)}</h1><p>${esc(e instanceof Error?e.message:'Could not start top-up checkout.')}</p><p><a href="/account">Back</a></p>`));}
  });

  app.get('/billing/topup/success',async(_req,reply)=>{
    return reply.type('text/html').send(page(`<h1>Top-up received.</h1><p>Your paid balance will update as soon as the signed payment webhook is processed.</p><p><strong>No automatic overage charges.</strong></p><script>setTimeout(()=>location.href='/account',1800)</script>`));
  });

  app.get('/billing/success',async(req,reply)=>{""",
)
replace_once(
    "src/billing/routes.ts",
    "    const rolloverLine=usage.plan==='trial'?'':` Unused paid subscription units roll over; the founding bonus does not.`;\n    return reply.type('text/html').send(page(`",
    "    const rolloverLine=usage.plan==='trial'?'':` Unused paid subscription and purchased top-up units persist while subscribed; the founding bonus does not.`;\n    const topupEligible=await canPurchaseTopup(user.id);\n    return reply.type('text/html').send(page(`",
)
replace_once(
    "src/billing/routes.ts",
    "${renew}${trialActions}<p class=\"fine\">${esc(env().PUBLIC_BRAND_NAME)} keeps temporary media/audio only while processing.",
    "${renew}${trialActions}${topupEligible?topupSection(req.headers.cookie):''}<p class=\"fine\">${esc(env().PUBLIC_BRAND_NAME)} keeps temporary media/audio only while processing.",
)

Path("sql/004_topup_ledger.sql").write_text(
    """CREATE TABLE IF NOT EXISTS paid_unit_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('subscription_grant','topup_purchase','topup_refund','admin_adjustment')),
  units_delta integer NOT NULL,
  source_key text NOT NULL UNIQUE,
  provider text,
  provider_reference_id text,
  provider_total_cents integer NOT NULL DEFAULT 0 CHECK (provider_total_cents >= 0),
  provider_refunded_cents integer NOT NULL DEFAULT 0 CHECK (provider_refunded_cents >= 0),
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS paid_unit_transactions_user_created_idx ON paid_unit_transactions(user_id,created_at DESC);
CREATE INDEX IF NOT EXISTS paid_unit_transactions_provider_ref_idx ON paid_unit_transactions(provider,provider_reference_id);
"""
)

Path(".github/workflows/offsite-db-backup.yml").write_text(
    """name: Offsite DB backup
on:
  schedule:
    - cron: '17 3 * * *'
  workflow_dispatch:
permissions:
  contents: read
jobs:
  backup:
    runs-on: ubuntu-latest
    timeout-minutes: 25
    env:
      BACKUP_DATABASE_URL: ${{ secrets.BACKUP_DATABASE_URL }}
      BACKUP_S3_BUCKET: ${{ secrets.BACKUP_S3_BUCKET }}
      BACKUP_S3_REGION: ${{ secrets.BACKUP_S3_REGION }}
      BACKUP_S3_ACCESS_KEY_ID: ${{ secrets.BACKUP_S3_ACCESS_KEY_ID }}
      BACKUP_S3_SECRET_ACCESS_KEY: ${{ secrets.BACKUP_S3_SECRET_ACCESS_KEY }}
      BACKUP_S3_ENDPOINT: ${{ secrets.BACKUP_S3_ENDPOINT }}
      BACKUP_ENCRYPTION_PASSPHRASE: ${{ secrets.BACKUP_ENCRYPTION_PASSPHRASE }}
      BACKUP_HMAC_KEY: ${{ secrets.BACKUP_HMAC_KEY }}
    steps:
      - name: Validate backup configuration
        shell: bash
        run: |
          set -euo pipefail
          for k in BACKUP_DATABASE_URL BACKUP_S3_BUCKET BACKUP_S3_REGION BACKUP_S3_ACCESS_KEY_ID BACKUP_S3_SECRET_ACCESS_KEY BACKUP_ENCRYPTION_PASSPHRASE BACKUP_HMAC_KEY; do
            test -n "${!k:-}" || { echo "Missing required backup secret: $k"; exit 1; }
          done
      - name: Install backup clients
        shell: bash
        run: |
          set -euo pipefail
          sudo apt-get update -qq
          sudo apt-get install -y -qq postgresql-client python3-venv
          python3 -m venv "$RUNNER_TEMP/awsvenv"
          "$RUNNER_TEMP/awsvenv/bin/pip" install -q awscli
      - name: Dump, encrypt and sign
        shell: bash
        run: |
          set -euo pipefail
          umask 077
          TS="$(date -u +%Y%m%dT%H%M%SZ)"
          DIR="$RUNNER_TEMP/link2ai-backup-$TS"
          mkdir -p "$DIR"
          pg_dump --format=custom --compress=9 --no-owner --no-acl "$BACKUP_DATABASE_URL" -f "$DIR/link2ai.dump"
          PLAIN_SHA="$(sha256sum "$DIR/link2ai.dump" | awk '{print $1}')"
          openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass env:BACKUP_ENCRYPTION_PASSPHRASE -in "$DIR/link2ai.dump" -out "$DIR/link2ai.dump.enc"
          ENC_SHA="$(sha256sum "$DIR/link2ai.dump.enc" | awk '{print $1}')"
          python3 - "$DIR/manifest.json" "$TS" "$PLAIN_SHA" "$ENC_SHA" <<'PY'
          import json,os,sys
          path,ts,plain,enc=sys.argv[1:]
          with open(path,'w') as f: json.dump({'timestamp_utc':ts,'format':'pg_dump-custom','encryption':'aes-256-cbc-pbkdf2-200000','plaintext_sha256':plain,'encrypted_sha256':enc,'repository':os.environ.get('GITHUB_REPOSITORY'),'git_sha':os.environ.get('GITHUB_SHA')},f,separators=(',',':'),sort_keys=True)
          PY
          python3 - "$DIR/manifest.json" "$DIR/manifest.hmac" <<'PY'
          import hashlib,hmac,os,sys
          data=open(sys.argv[1],'rb').read(); key=os.environ['BACKUP_HMAC_KEY'].encode()
          open(sys.argv[2],'w').write(hmac.new(key,data,hashlib.sha256).hexdigest()+'\\n')
          PY
          rm -f "$DIR/link2ai.dump"
          echo "BACKUP_DIR=$DIR" >> "$GITHUB_ENV"
          echo "BACKUP_TS=$TS" >> "$GITHUB_ENV"
      - name: Upload with immutable retention and verify lock
        shell: bash
        env:
          AWS_ACCESS_KEY_ID: ${{ secrets.BACKUP_S3_ACCESS_KEY_ID }}
          AWS_SECRET_ACCESS_KEY: ${{ secrets.BACKUP_S3_SECRET_ACCESS_KEY }}
          AWS_DEFAULT_REGION: ${{ secrets.BACKUP_S3_REGION }}
        run: |
          set -euo pipefail
          AWS="$RUNNER_TEMP/awsvenv/bin/aws"
          EXTRA=()
          if [ -n "${BACKUP_S3_ENDPOINT:-}" ]; then EXTRA+=(--endpoint-url "$BACKUP_S3_ENDPOINT"); fi
          RETAIN="$(date -u -d '+90 days' +%Y-%m-%dT%H:%M:%SZ)"
          PREFIX="daily/${BACKUP_TS}"
          for f in link2ai.dump.enc manifest.json manifest.hmac; do
            "$AWS" "${EXTRA[@]}" s3api put-object --bucket "$BACKUP_S3_BUCKET" --key "$PREFIX/$f" --body "$BACKUP_DIR/$f" --object-lock-mode COMPLIANCE --object-lock-retain-until-date "$RETAIN" >/dev/null
            MODE="$("$AWS" "${EXTRA[@]}" s3api head-object --bucket "$BACKUP_S3_BUCKET" --key "$PREFIX/$f" --query ObjectLockMode --output text)"
            test "$MODE" = COMPLIANCE || { echo "Object lock verification failed for $f"; exit 1; }
          done
          if [ "$(date -u +%d)" = "01" ]; then
            LONG_RETAIN="$(date -u -d '+400 days' +%Y-%m-%dT%H:%M:%SZ)"
            MPREFIX="monthly/$(date -u +%Y-%m)/${BACKUP_TS}"
            for f in link2ai.dump.enc manifest.json manifest.hmac; do
              "$AWS" "${EXTRA[@]}" s3api put-object --bucket "$BACKUP_S3_BUCKET" --key "$MPREFIX/$f" --body "$BACKUP_DIR/$f" --object-lock-mode COMPLIANCE --object-lock-retain-until-date "$LONG_RETAIN" >/dev/null
            done
          fi
          echo "Encrypted logical backup uploaded and COMPLIANCE lock verified."
"""
)

Path("docs/BACKUP_RUNBOOK.md").parent.mkdir(parents=True, exist_ok=True)
Path("docs/BACKUP_RUNBOOK.md").write_text(
    """# Link2AI production backup runbook

Production uses three recovery layers:

1. Railway scheduled volume backups.
2. Railway Postgres PITR (continuous WAL + rolling base backups).
3. Offsite encrypted logical dumps in a different provider/account with S3 Object Lock **COMPLIANCE** mode.

## Offsite workflow

`.github/workflows/offsite-db-backup.yml` runs daily. Daily objects are immutable for 90 days. A second monthly copy is retained for 400 days. The workflow fails if Object Lock is not actually returned by `head-object`; it must never silently downgrade to a mutable upload.

Required GitHub Actions secrets:

- `BACKUP_DATABASE_URL` — Railway Postgres public connection URL; a read-only backup credential is preferred.
- `BACKUP_S3_BUCKET` — bucket created with Object Lock enabled and versioning on.
- `BACKUP_S3_REGION`
- `BACKUP_S3_ACCESS_KEY_ID`
- `BACKUP_S3_SECRET_ACCESS_KEY`
- `BACKUP_S3_ENDPOINT` — optional for a compatible non-AWS endpoint.
- `BACKUP_ENCRYPTION_PASSPHRASE` — long random secret stored separately from the bucket account.
- `BACKUP_HMAC_KEY` — independent long random secret used to authenticate the manifest.

Do not store backup credentials in Railway or in this repository. Keep an offline copy of the encryption passphrase and HMAC key.

## Restore drill

Download one `daily/<timestamp>/` set, verify `manifest.hmac`, verify the encrypted SHA-256, decrypt with `openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000`, then restore into a throwaway Postgres with `pg_restore`. Run this drill at least quarterly. A backup that has never been restored is not considered verified.
"""
)

Path("test/topup-backup-schema.mjs").write_text(
    """import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const env=await readFile('src/config/env.ts','utf8');
const lemon=await readFile('src/billing/lemon.ts','utf8');
const routes=await readFile('src/billing/routes.ts','utf8');
const sql=await readFile('sql/004_topup_ledger.sql','utf8');
const backup=await readFile('.github/workflows/offsite-db-backup.yml','utf8');
assert.match(env,/LEMONSQUEEZY_TOPUP_500_VARIANT_ID/);
assert.match(env,/LEMONSQUEEZY_TOPUP_1500_VARIANT_ID/);
assert.match(lemon,/purpose:'topup'/);
assert.match(lemon,/ON CONFLICT\(source_key\) DO NOTHING/,'top-up webhook must be idempotent');
assert.match(lemon,/GREATEST\(0,paid_rollover_seconds-\$2\)/,'refunds must never create a negative paid wallet');
assert.match(lemon,/status IN \('active','trialing'\)/,'only active paid subscribers may start top-up checkout');
assert.match(routes,/No automatic overage charges/);
assert.match(sql,/source_key text NOT NULL UNIQUE/);
assert.match(sql,/subscription_grant/);
assert.match(sql,/topup_purchase/);
assert.match(sql,/topup_refund/);
assert.match(backup,/object-lock-mode COMPLIANCE/);
assert.match(backup,/head-object/);
assert.match(backup,/\+90 days/);
assert.match(backup,/\+400 days/);
assert.doesNotMatch(backup,/upload-artifact/,'database dumps must not be copied into GitHub Actions artifacts');
console.log('top-up + backup schema: ok');
"""
)

pkg = Path("package.json")
data = json.loads(pkg.read_text())
marker = "node test/admin-passkey-schema.mjs && "
if "node test/topup-backup-schema.mjs" not in data["scripts"]["test"]:
    data["scripts"]["test"] = data["scripts"]["test"].replace(marker, marker + "node test/topup-backup-schema.mjs && ")
pkg.write_text(json.dumps(data, indent=2) + "\n")
