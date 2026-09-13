declare var process: any;
declare var Buffer: any;
type Buffer = any;
declare module 'node:crypto' { const x:any; export default x; }
declare module 'node:child_process' { export const spawn:any; }
declare module 'node:fs/promises' { const x:any; export default x; }
declare module 'node:path' { const x:any; export default x; }
declare module 'node:url' { export const fileURLToPath:any; }
declare module 'node:os' { const x:any; export default x; }
declare module 'node:net' { const x:any; export default x; }
declare module 'node:dns/promises' { export const lookup:any; }
declare module 'node:http' { const x:any; export default x; export type IncomingHttpHeaders=any; }
declare module 'node:https' { const x:any; export default x; export type IncomingHttpHeaders=any; }
declare module 'fastify' { export type FastifyInstance = any; export type FastifyReply = any; export type FastifyRequest = any; }
declare module '@modelcontextprotocol/fastify' { export function createMcpFastifyApp(options?: any): any; }
declare module '@modelcontextprotocol/node' { export function toNodeHandler(handler: any, options?: any): any; }
declare module '@modelcontextprotocol/server' { export interface AuthInfo { token:string; clientId:string; scopes:string[]; expiresAt?:number; resource?:URL; extra?:Record<string,unknown>; } export class McpServer { constructor(info:any, options?:any); registerTool(name:string, config:any, cb:any): any; } export function createMcpHandler(factory:any, options?:any): any; }
declare module 'zod/v4' { export const object: any; export const string: any; export const number: any; }
declare module 'zod' { export const z:any; export namespace z { type infer<T> = any; } }
declare module 'pg' {
  export interface QueryResult<T=any>{ rows:T[]; rowCount:number; }
  export interface PoolClient { query<T=any>(text:string, params?:any[]): Promise<QueryResult<T>>; release():void; }
  export class Pool { constructor(opts?:any); query<T=any>(text:string, params?:any[]):Promise<QueryResult<T>>; connect():Promise<PoolClient>; end():Promise<void>; }
  const pg:{Pool:typeof Pool}; export default pg;
}
