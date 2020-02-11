import { BLOCK_CACHE, BLOCK_PAGE, PAYMENT_CACHE, PAYMENT_PAGE, general, coin, payouts } from '../constants'

import logger         from '../logger'
import * as utils     from '../utils'
import * as time      from '../time'

import * as global    from './global'
import * as users     from './users'
import * as pages     from './pages'
import * as graphs    from './graphs'

/* Memory Caches */
/* These variables hold some in-memory caches that are used frequently */

const mem_cache = {

  /* Global stats */

  event_counter: {                 // incremental values for events
    '1m': 0,
    '5m': 0,
    '1hr': 0,
    block: 0,
  },

  /* Global stats */

  network_info: {},                // Last network_block
  payoutd_info: {},                // Last scan_height
  price_info: {},                  // Market info

  pool_hashrate_15m: 0,            // pool hashrate over 15m
  pool_hashrate_1hr: 0,            // pool hashrate over 1h
  pool_hashrate_6hr: 0,            // pool hashrate over 6h
  pool_hashrate_24hr: 0,           // pool hashrate over 24h

  pool_hashrate_graph_24hr: [],    // pool hashrate graph
  pool_hashrate_graph_7d: [],      // pool hashrate graph
  pool_hashrate_graph_30d: [],     // pool hashrate graph

  network_hashrate_graph_24hr: [], // network hashrate graph points
  network_hashrate_graph_7d: [],   // network hashrate graph points
  network_hashrate_graph_30d: [],  // network hashrate graph points

  pplns_window: {                  // PPLNS time
    utc: 0,                        // start_time in UTC
    relative: 0,                   // start_time in seconds from now
  },

  current_shares: {                // number of shares submitted
    block: 0,
    pplns: 0,
  },

  active: {
    miners: 0,                     // number of users mining
    workers: 0,                    // number of workers mining
  },

  top_miners: [],                  // top 10 miners by hashrate

  blocks: [],                      // last BLOCK_CACHE mined_blocks
  blocks_count: 0,                 // total blocks mined
  blocks_per_hour: [],             // graph for blocks per hour / day
  blocks_count_by_type: {          // count of blocks by type
    blocks_total: 0,
    blocks_orphaned: 0,
    blocks_failed: 0,
    blocks_ok: 0,
    blocks_tx_seen: 0,
    blocks_credited: 0,
    blocks_matured: 0,
    blocks_closed: 0,
    total_mined: 0
  },

  payments: [],                    // last PAYMENT_CACHE payments
  payments_count: 0,               // total number of payments
  payments_count_by_type: {        // payments by type
    payment_total: 0,
    payment_orphaned: 0,
    payment_pending: 0,
    payment_matured: 0,
    total_paid: 0,
    total_fee: 0,
    total_payees: 0
  },

  average_efforts: {               // average efforts over last N blocks
    all: {
      total_shares: 0,
      difficulty: 0
    },
    last_100: {
      total_shares: 0,
      difficulty: 0
    },
    last_1000: {
      total_shares: 0,
      difficulty: 0
    },
  },

  /* User stats */

  users: new Map(),                // user map with uid as key

  users_hashrate_15m: new Map(),   // current user hashrates
  users_hashrate_1hr: new Map(),   // users hashrates over 1 hr
  users_hashrate_6hr: new Map(),   // users hashrates over 6 hrs
  users_hashrate_24hr: new Map(),  // users hashrates over 24 hrs

  users_rigs: new Map(),           // user rigs
  users_balance: new Map(),        // user balances
  users_shares: new Map(),         // user shares in pplns window

}

// Prevent new keys from being added
Object.seal(mem_cache)

/* Export functions */
/* These functions return specific pieces of information from mem_cache for other modules */

// Export the entire mem cache object for other modules
export function getMemCache() {
  return mem_cache
}

// Get the users from the DB and store in mem_cache
export function getUsers() {
  return users.getUsers().then(users => {
    mem_cache.users = users
    return mem_cache.users
  }).catch(error => {
    if(mem_cache.users.size === 0) {
      logger.log('error', 'stats', 'Fatal: Error getting users from database %s', [error])
      process.exit()
    }
    return mem_cache.users
  })
}

// This function returns global stats to be sent to the frontend every 30s
export function getStats() {
  return {
    coin,
    network_info:            mem_cache.network_info,
    price_info:              mem_cache.price_info,
    pool_info: {
      hashrate: {
        current:             mem_cache.pool_hashrate_15m,
        average_1hr:         mem_cache.pool_hashrate_1hr,
        average_6hr:         mem_cache.pool_hashrate_6hr,
        average_24hr:        mem_cache.pool_hashrate_24hr,
      },
      users_count:           mem_cache.users_count,
      active:                mem_cache.active,
      top_miners:            mem_cache.top_miners,
      current_shares:        mem_cache.current_shares,
      average_efforts:       mem_cache.average_efforts,
      blocks_recent:         mem_cache.blocks.slice(0, 1),
      blocks_count:          mem_cache.blocks_count_by_type,
      blocks_graph:          mem_cache.blocks_per_hour,
      payments_count:        mem_cache.payments_count_by_type,
      pplns_window:          mem_cache.pplns_window.utc,
      pplns_window_relative: mem_cache.pplns_window.relative,
      payouts
    },
    events:                  mem_cache.event_counter
  }
}

// This function returns user stats to be sent to the frontend every 30s for users that are on the webpage
export function getUserStats(uid) {
  let info = { ...utils.get_or_empty_map(mem_cache.users, uid) }
  delete info.password
  delete info.rigs_rid
  delete info.rigs_name
  delete info.code_group

  return {
    info,
    balances:                  utils.get_or_default_map(mem_cache.users_balance, uid),
    rigs:                      utils.get_or_default_map(mem_cache.users_rigs, uid),
    shares:                    utils.get_or_default_map(mem_cache.users_shares, uid),
    hashrate: {
      current:                 utils.get_or_default_map(mem_cache.users_hashrate_15m, uid),
      average_1hr:             utils.get_or_default_map(mem_cache.users_hashrate_1hr, uid),
      average_6hr:             utils.get_or_default_map(mem_cache.users_hashrate_6hr, uid),
      average_24hr:            utils.get_or_default_map(mem_cache.users_hashrate_24hr, uid)
    }
  }
}

// Store heights on network and payoutd from last 30s interval
let last_network_height = 0
let last_payoutd_height = 0
let first_run = true

export async function run30s() {

  // Check if network or payoutd have changed height

  mem_cache.network_info = await global.getNetworkInfo()
  mem_cache.payoutd_info = await global.getPayoutdInfo()

  let seen_network_block = false
  let seen_payoutd_block = false

  if(mem_cache.network_info.height > last_network_height) {
    seen_network_block = true
    last_network_height = mem_cache.network_info.height
  }

  if(mem_cache.payoutd_info.height > last_payoutd_height) {
    seen_payoutd_block = true
    last_payoutd_height = mem_cache.payoutd_info.height
  }

  if(first_run) {
    seen_network_block = true
    seen_payoutd_block = true
  }

  // Increment the block height event counter
  mem_cache.event_counter.block = Math.max(last_network_height, last_payoutd_height)

  // Update users map, this updated every 30s because of ban status updates
  // Map may also be updated on a user action such as register or save settings
  await getUsers()

  // Get hashrates
  mem_cache.pool_hashrate_15m = await global.getPoolHashrate(15 * 60)
  mem_cache.pool_hashrate_1hr = await global.getPoolHashrate(60 * 60)
  mem_cache.pool_hashrate_6hr = await global.getPoolHashrate(6 * 60 * 60)
  mem_cache.pool_hashrate_24hr = await global.getPoolHashrate(24 * 60 * 60)

  mem_cache.users_hashrate_15m = await users.getUsersHashrates(15 * 60)
  mem_cache.users_hashrate_1hr = await users.getUsersHashrates(60 * 60)
  mem_cache.users_hashrate_6hr = await users.getUsersHashrates(6 * 60 * 60)
  mem_cache.users_hashrate_24hr = await users.getUsersHashrates(24 * 60 * 60)

  // Get all rigs, if they are active, and their last share timestamps
  Object.assign(mem_cache, await users.getRigs())

  // get top 10 miners
  mem_cache.top_miners = await users.getTopUsers(10)

  // Update mined_blocks cache if new network or payoutd block
  if(seen_network_block || seen_payoutd_block) {
    if(!general.secondary) {
      await global.generateTotalShares()
    }
    Object.assign(mem_cache, await pages.getBlocksPaged(0, BLOCK_CACHE))
    mem_cache.blocks_count_by_type = await global.getBlocksCount()
    mem_cache.payments_count_by_type = await global.getPaymentCount()
    mem_cache.blocks_per_hour = await graphs.getBlocksPerHour()
  }

  // Balances or payments can only change if payoutd has changed height
  if(seen_payoutd_block) {
    Object.assign(mem_cache, await pages.getPaymentsPaged(0, PAYMENT_CACHE))
    Object.assign(mem_cache, await users.getUserBalances())
  }

  // Get the PPLNS window
  mem_cache.pplns_window.utc = await global.getPPLNSWindow(mem_cache.network_info.difficulty)
  mem_cache.pplns_window.relative = time.now() - mem_cache.pplns_window.utc

  // Get current shares for PPLNS window
  mem_cache.current_shares.pplns = await global.getTotalSharesSince(mem_cache.pplns_window.utc)

  // Get user shares for PPLNS window
  mem_cache.users_shares = await users.getTotalSharesSince(mem_cache.pplns_window.utc)

  // Get current shares for this block
  const last_block_timestamp = mem_cache.blocks.length ? mem_cache.blocks[0].time : 0
  mem_cache.current_shares.block = await global.getTotalSharesSince(last_block_timestamp)

  // Get average efforts
  mem_cache.average_efforts = await global.getAverageEfforts()

}

export async function run1m() {
  // Increment the 1m event counter
  mem_cache.event_counter['1m'] = (mem_cache.event_counter['1m'] + 1) % Number.MAX_SAFE_INTEGER
}

export async function run5m() {
  // Increment the 5m event counter
  mem_cache.event_counter['5m'] = (mem_cache.event_counter['5m'] + 1) % Number.MAX_SAFE_INTEGER

  // Make 5 min resolution hashrate graphs for all users and pool
  if(!general.secondary) {
    await graphs.generateHashrate('5m')
  }

  // Get 24h hashrate graph for pool and network
  mem_cache.pool_hashrate_graph_24hr = await graphs.getHashrate('24hr')
  mem_cache.network_hashrate_graph_24hr = await graphs.getNetworkHashrate24hr()

}

export async function run1hr() {
  // Increment the 1hr event counter
  mem_cache.event_counter['1hr'] = (mem_cache.event_counter['1hr'] + 1) % Number.MAX_SAFE_INTEGER

  // Make 1 hr resolution hashrate graphs for all users and pool
  if(!general.secondary) {
    await graphs.generateHashrate('1hr')
  }

  // Get 7d hashrate graph for pool and network
  mem_cache.pool_hashrate_graph_7d = await graphs.getHashrate('7d')
  mem_cache.network_hashrate_graph_7d = await graphs.getNetworkHashrate7d()

  // Get 30d hashrate graph for pool and network
  mem_cache.pool_hashrate_graph_30d = await graphs.getHashrate('30d')
  mem_cache.network_hashrate_graph_30d = await graphs.getNetworkHashrate30d()

  // Get market data
  mem_cache.price_info = await global.getPrice()

}

export async function runAfter() {
  // Nothing to do here, but can use this function to run code
  // after all other run functions have completed
  first_run = false
}
