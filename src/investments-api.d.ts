import type { Asset, Operation, Quote, State } from "../shared/investments.mjs"

declare global {
  interface Window {
    ordefinInvestments?: {
      load(legacy?: Record<string, string>): Promise<State>
      complete(id: string, quantity: string): Promise<State>
      add(op: Operation): Promise<State>
      editAmount(id: string, value: string): Promise<State>
      editDetails(id: string, patch: { amount?: string; fees?: string; quantity?: string | null; date?: string }): Promise<State>
      quote(asset: Asset, date?: string): Promise<Quote>
      history(asset: Asset, fromDate: string): Promise<{source: string; points: {date: string; price: string}[]}>
      manual(asset: Asset, q: Partial<Quote>): Promise<State>
      observe(): Promise<State>
      resetPortfolio(confirmation: string): Promise<State>
      deleteAsset(key: string, confirmation: string): Promise<State>
      deleteOperation(id: string, confirmation: string): Promise<State>
    }
  }
}

export {}
