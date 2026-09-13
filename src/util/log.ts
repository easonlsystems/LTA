export function logEvent(event:string,fields:Record<string,unknown>={}):void{
  console.log(JSON.stringify({ts:new Date().toISOString(),event,...fields}));
}

export function logErrorEvent(event:string,error:unknown,fields:Record<string,unknown>={}):void{
  const err=error instanceof Error?error:null;
  console.error(JSON.stringify({
    ts:new Date().toISOString(),event,...fields,
    error_name:err?.name??'UnknownError',
    error_message:err?.message??String(error)
  }));
}
