function clean(value:unknown,max=160):string|null{
  if(typeof value!=='string')return null;
  const trimmed=value.trim();
  return trimmed?trimmed.slice(0,max):null;
}

export interface RuntimeRelease{
  commitSha:string|null;
  commitShort:string;
  deploymentId:string|null;
  serviceName:string|null;
  environmentName:string|null;
  replicaRegion:string|null;
}

export function runtimeRelease():RuntimeRelease{
  const commitSha=clean(process.env.RAILWAY_GIT_COMMIT_SHA,64);
  return {
    commitSha,
    commitShort:commitSha?commitSha.slice(0,12):'unknown',
    deploymentId:clean(process.env.RAILWAY_DEPLOYMENT_ID,160),
    serviceName:clean(process.env.RAILWAY_SERVICE_NAME,120),
    environmentName:clean(process.env.RAILWAY_ENVIRONMENT_NAME,120),
    replicaRegion:clean(process.env.RAILWAY_REPLICA_REGION,120)
  };
}
