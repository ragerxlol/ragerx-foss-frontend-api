import { InternalError } from '../../errors'

import { getStats } from '../../stats'
import * as pages from '../../stats/pages'

export async function stats(ctx) {
  if(ctx.method !== 'GET') {
    throw new InternalError('Method must be GET')
  }
  return getStats()
}

export async function blocks(ctx) {
  if(ctx.method !== 'GET') {
    throw new InternalError('Method must be GET')
  }
  const page = ctx.query.page ?? 1
  return await pages.getBlocks(page - 1)
}

export async function payments(ctx) {
  if(ctx.method !== 'GET') {
    throw new InternalError('Method must be GET')
  }
  const page = ctx.query.page ?? 1
  return await pages.getPayments(page - 1)
}

export async function graphs(ctx) {
  if(ctx.method !== 'GET') {
    throw new InternalError('Method must be GET')
  }
  const type = ctx.query.type ?? 'pool_hashrate_graph'
  const length = ctx.query.resolution ?? '24h'
  return await pages.getHashrateGraph(type, length)
}
