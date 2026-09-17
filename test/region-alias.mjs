import assert from 'node:assert/strict';
import { DEFAULT_PRODUCTION_REGION_ORDER, normalizeWorkerRegion, regionalFallbackTarget, workerRegionRuntime } from '../.pure-dist/src/worker/regions.js';

assert.deepEqual([...DEFAULT_PRODUCTION_REGION_ORDER],['ams','sin','sfo']);
assert.equal(normalizeWorkerRegion('ams'),'ams');
assert.equal(normalizeWorkerRegion('europe-west4-drams3a'),'ams');
assert.equal(normalizeWorkerRegion('asia-southeast1-eqsg3a'),'sin');
assert.equal(normalizeWorkerRegion('us-west2'),'sfo');

const amsRuntime=workerRegionRuntime({RAILWAY_REPLICA_REGION:'ams'});
assert.equal(amsRuntime.currentRegion,'ams');
assert.equal(amsRuntime.primaryRegion,'ams');
assert.deepEqual(amsRuntime.regionOrder,['ams','sin','sfo']);

const legacyRuntime=workerRegionRuntime({RAILWAY_REPLICA_REGION:'europe-west4-drams3a'});
assert.equal(legacyRuntime.currentRegion,'ams');
assert.equal(legacyRuntime.primaryRegion,'ams');
assert.deepEqual(legacyRuntime.regionOrder,['ams','sin','sfo']);

const configuredRuntime=workerRegionRuntime({
  RAILWAY_REPLICA_REGION:'sin',
  WORKER_REGION_ORDER:'europe-west4-drams3a, asia-southeast1-eqsg3a, us-west2'
});
assert.equal(configuredRuntime.currentRegion,'sin');
assert.deepEqual(configuredRuntime.regionOrder,['ams','sin','sfo']);

assert.equal(regionalFallbackTarget({
  platform:'youtube',errorCode:'GEO_BLOCKED',regionOrder:['ams','sin','sfo'],attemptedRegions:['ams'],currentRegion:'ams'
}),'sin');
assert.equal(regionalFallbackTarget({
  platform:'youtube',errorCode:'GEO_BLOCKED',regionOrder:['europe-west4-drams3a','asia-southeast1-eqsg3a','us-west2'],attemptedRegions:['europe-west4-drams3a'],currentRegion:'ams'
}),'sin');
assert.equal(regionalFallbackTarget({
  platform:'youtube',errorCode:'GEO_BLOCKED',regionOrder:['ams','sin','sfo'],attemptedRegions:['ams','sin'],currentRegion:'sin'
}),'sfo');
assert.equal(regionalFallbackTarget({
  platform:'youtube',errorCode:'GEO_BLOCKED',regionOrder:['ams','sin','sfo'],attemptedRegions:['ams','sin','sfo'],currentRegion:'sfo'
}),null);
assert.equal(regionalFallbackTarget({
  platform:'youtube',errorCode:'PLATFORM_BLOCKED',regionOrder:['ams','sin','sfo'],attemptedRegions:[],currentRegion:'ams'
}),null);

console.log('region alias tests PASS');
