import type { PoolClient } from 'pg';
import { pool } from '../db/pool.js';
import { FOUNDING_CYCLES, FOUNDING_LIMIT, foundingProgressText, type FoundingPlan } from './foundingPolicy.js';

interface FoundingUserRow{
  founding_plan:FoundingPlan|null;
  founding_claimed_at:Date|null;
  founding_cycles_used:number;
  founding_period_start:Date|null;
  founding_ended_at:Date|null;
  founding_slot_released_at:Date|null;
}

export interface FoundingOfferStatus{
  claimed:number;
  remaining:number;
  open:boolean;
  progressText:string|null;
}

export async function getFoundingOfferStatus():Promise<FoundingOfferStatus>{
  const r=await pool.query<{count:string}>(`SELECT COUNT(*)::text count FROM users WHERE founding_claimed_at IS NOT NULL AND founding_slot_released_at IS NULL`);
  const claimed=Math.max(0,Number(r.rows[0]?.count??0)||0);
  return {claimed,remaining:Math.max(0,FOUNDING_LIMIT-claimed),open:claimed<FOUNDING_LIMIT,progressText:foundingProgressText(claimed)};
}

export async function reconcileFoundingOffer(client:PoolClient,input:{userId:string;plan:FoundingPlan;status:string;periodStart:Date|null;firstSubscription:boolean}):Promise<void>{
  const user=await client.query<FoundingUserRow>(
    `SELECT founding_plan,founding_claimed_at,founding_cycles_used,founding_period_start,founding_ended_at,founding_slot_released_at FROM users WHERE id=$1 FOR UPDATE`,
    [input.userId]
  );
  if(!user.rowCount)return;
  const row=user.rows[0];
  if(row.founding_claimed_at){
    if(row.founding_slot_released_at||row.founding_ended_at)return;
    if(row.founding_plan!==input.plan){
      await client.query(`UPDATE users SET founding_ended_at=COALESCE(founding_ended_at,now()),updated_at=now() WHERE id=$1`,[input.userId]);
      return;
    }
    if(input.status==='canceled'){
      await client.query(`UPDATE users SET founding_ended_at=COALESCE(founding_ended_at,now()),updated_at=now() WHERE id=$1`,[input.userId]);
      return;
    }
    if(input.status!=='active'&&input.status!=='trialing')return;
    if(!input.periodStart)return;
    const last=row.founding_period_start;
    if(!last){
      await client.query(`UPDATE users SET founding_period_start=$2,founding_cycles_used=GREATEST(1,founding_cycles_used),updated_at=now() WHERE id=$1`,[input.userId,input.periodStart]);
      return;
    }
    if(input.periodStart.getTime()<=last.getTime())return;
    if(row.founding_cycles_used>=FOUNDING_CYCLES){
      await client.query(`UPDATE users SET founding_ended_at=COALESCE(founding_ended_at,now()),updated_at=now() WHERE id=$1`,[input.userId]);
      return;
    }
    await client.query(`UPDATE users SET founding_cycles_used=founding_cycles_used+1,founding_period_start=$2,updated_at=now() WHERE id=$1`,[input.userId,input.periodStart]);
    return;
  }
  if(!input.firstSubscription||(input.status!=='active'&&input.status!=='trialing'))return;
  await client.query(`SELECT pg_advisory_xact_lock(hashtext('link2ai:founding-offer:v1'))`);
  const count=await client.query<{count:string}>(`SELECT COUNT(*)::text count FROM users WHERE founding_claimed_at IS NOT NULL AND founding_slot_released_at IS NULL`);
  if(Number(count.rows[0]?.count??0)>=FOUNDING_LIMIT)return;
  await client.query(
    `UPDATE users SET founding_plan=$2,founding_claimed_at=now(),founding_cycles_used=1,founding_period_start=$3,founding_ended_at=NULL,founding_slot_released_at=NULL,updated_at=now() WHERE id=$1 AND founding_claimed_at IS NULL`,
    [input.userId,input.plan,input.periodStart]
  );
}

export async function releaseFoundingSlotForInitialRefund(userId:string):Promise<void>{
  await pool.query(
    `UPDATE users SET founding_slot_released_at=COALESCE(founding_slot_released_at,now()),founding_ended_at=COALESCE(founding_ended_at,now()),updated_at=now() WHERE id=$1 AND founding_claimed_at IS NOT NULL AND founding_cycles_used<=1 AND founding_slot_released_at IS NULL`,
    [userId]
  );
}
