export interface Asset {category:string;symbol:string;maturity?:string;institution?:string;rateType?:string;rate?:string;contract?:string;purchaseDate?:string}
export interface Quote {price:string;date:string;source:string;kind:string;fetchedAt:number;stale:boolean;error?:string;requestedDate?:string;marketTime?:number}
export interface Operation {id:string;type:'buy'|'sell';asset:Asset;date:string;amount:string;fees:string;quantity:string|null;estimated?:boolean;purchaseQuote?:Quote;accountId?:number;bankMode?:'move'|'recorded';bankReference?:string;createdAt?:number}
export interface Observation {date:string;time:number;value:string;cost:string;result:string;source:string}
export interface State {version:number;operations:Operation[];quotes:Record<string,Quote>;observations:Observation[];warnings:string[]}
export interface Position {key:string;asset:Asset;quantity:string|null;cost:string;realized:string;contributions:string;average:string|null;value:string|null;result:string|null;percent:string|null;closed:boolean;estimated:boolean;quote?:Quote;operations:Operation[]}
export const CATEGORIES:string[];
export function decimal(value:import('decimal.js').Decimal.Value):import('decimal.js').Decimal;
export function assetKey(asset:Asset):string;
export function localDate():string;
export function validDate(date:string):boolean;
export function validateOperation(op:Operation):Operation;
export function portfolio(ops:Operation[],quotes?:Record<string,Quote>):Position[];
export function currencyInput(value:string):string;
export function parseBrazilian(value:string):string;
export function cashTimeline(ops:Operation[]):{date:string;contributions:string;withdrawals:string}[];
