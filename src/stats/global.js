import { coin, market } from '../constants'

import * as time from '../time'
import { pool } from '../database'
import logger from '../logger'

import rp from 'request-promise'

let price_cache = { 'BTC': 0 }

export function getPrice() {
  const currencies = ['BTC','USD','CAD','AUD','EUR','GBP','RUB','JPY','CNY']
  const api_link = 'https://min-api.cryptocompare.com/data/price?fsym=XMR&tsyms=' + currencies.join(',') + '&api_key=' + market.crypto_compare_api_key
  return rp(api_link).then(response => {
    if(response.hasOwnProperty('Response') && response.Response === 'Error') {
      return price_cache
    }
    try {
      price_cache = JSON.parse(response)
    } catch(error) {
    }
    return price_cache
  }).catch(error => {
    return price_cache
  })
}

let network_info_cache = {
  difficulty: 0,
  height: 0,
  hashrate: 0,
  last_timestamp: 0,
  last_reward: 0
}

export async function getNetworkInfo() {
  try {
    network_info_cache = await getNetworkInfoDatabase()
    return network_info_cache
  } catch(error) {
    logger.log('error', 'global', 'Error getting network info from database')
    try {
      network_info_cache = await getNetworkInfoExplorer()
      return network_info_cache
    } catch(error) {
      logger.log('error', 'global', 'Error getting network info from explorer')
      return network_info_cache
    }
  }
}

// Get network info from network_blocks table
export function getNetworkInfoDatabase() {
  return pool.query('SELECT * FROM network_blocks ORDER BY height DESC LIMIT 1').then(res => {
    if(res.rows.length) {
      const block = res.rows[0]
      return {
        difficulty: parseInt(block.difficulty) || 0,
        height: block.height,
        hashrate: Math.round(100 * block.difficulty  / coin.coin_difficulty_target ) / 100,
        last_timestamp: time.db_time_to_walltime(block.time),
        last_reward: block.reward_total
      }
    } else {
      throw new Error('Table network_blocks is empty')
    }
  })
}

// Get network info from explorer. This function is only used as a backup.
export function getNetworkInfoExplorer() {
  const api_link = coin.explorer_url + '/api/get_stats'
  return rp(api_link).then(response => {
    const { difficulty, height, hashrate, last_timestamp, last_reward } = JSON.parse(response)
    return {
      difficulty,
      height,
      hashrate,
      last_timestamp,
      last_reward
    }
  })
}

// Get payoutd scan_height
export function getPayoutdInfo() {
  return pool.query('SELECT height, time FROM scan_height').then(res => {
    if(res.rows.length) {
      const info = res.rows[0]
      return {
        height: info.height,
        time: time.db_time_to_walltime(info.time)
      }
    } else {
      throw new Error('Table scan_height is empty')
    }
  }).catch(error => {
    logger.log('error', 'global', 'Error getting payoutd info')
    return {
      height: 0,
      time: 0
    }
  })
}

// Get PPLNS start time as js timestamp (slower method)
const query_get_pplns_window_slow = {
  name: 'get-pplns-window-slow',
  text: `
  SELECT time, running_total
  FROM (
    SELECT time, SUM(count) OVER (ORDER BY time DESC) AS running_total
    FROM valid_shares
  ) t
  WHERE running_total <= $1
  ORDER BY time ASC
  LIMIT 1
  `
}

export function getPPLNSWindowSlow(diff) {
  const window = diff * 2
  return pool.query(query_get_pplns_window_slow.text, [window]).then(res => {
    return time.db_time_to_walltime(res.rows[0].time)
  }).catch(error => {
    logger.log('error', 'global', 'Error getting pplns window')
    logger.log('error', 'global', error)
    return 0
  })
}

const query_get_pplns_window_fn = {
  name: 'get-pplns-window-fn',
  text: `
  CREATE OR REPLACE FUNCTION pplns_window(BIGINT)
  RETURNS INT AS $$
  DECLARE
    ctime INT := 0;
    csum BIGINT := 0;
    cur_row RECORD;
  BEGIN
    FOR cur_row IN SELECT time, count FROM valid_shares ORDER BY time DESC
    LOOP
      csum := csum + cur_row.count;
      IF csum > $1 THEN
        RETURN ctime;
      END IF;
      ctime := cur_row.time;
    END LOOP;
    RETURN ctime;
  END;
  $$ LANGUAGE plpgsql;
  `
}

export function getPPLNSWindow(diff) {
  let start_time = 0
  const window = diff * 2
  return new Promise((resolve, reject) => {
    pool.connect(async (error, client, done) => {
      if(error) {
        logger.log('error', 'global', 'Error getting psql client for pplns window')
        logger.log('error', 'global', error)
      } else {
        try {
          await client.query(query_get_pplns_window_fn.text)
          const res = await client.query('SELECT pplns_window($1::BIGINT)', [window])
          start_time = time.db_time_to_walltime(res.rows[0].pplns_window)
        } catch(error) {
          logger.log('error', 'global', 'Error getting pplns window')
          logger.log('error', 'global', error)
        }
        done()
      }
      resolve(start_time)
    })
  })
}

// Get pool hashrates
const query_get_pool_hashrate = {
  name: 'get-pool-hashrate',
  text: `
  SELECT
  MIN(time) AS tstart,
  MAX(time) AS tend,
  SUM(CASE WHEN row_number = 1 THEN 0 ELSE count END) AS count
  FROM (
    SELECT
    count,
    time,
    ROW_NUMBER() OVER(ORDER BY time ASC) AS row_number
    FROM
    valid_shares
    WHERE time BETWEEN ($1::INT - $2::INT) AND $1::INT
    ORDER BY time ASC
  ) shares
  `
}

export function getPoolHashrate(duration) {
  let pool_hashrate = 0

  const tsample = time.walltime_to_db_time(time.now())
  return pool.query(query_get_pool_hashrate.text, [tsample, duration]).then(res => {
    if(res.rows.length) {
      const { tstart, tend, count } = res.rows[0]
      if(tstart !== tsample) {
        pool_hashrate = Math.round(count / (tsample - tstart))
      }
    }
    return pool_hashrate
  }).catch(error => {
    logger.log('error', 'global', 'Error getting pool hashrate')
    logger.log('error', 'global', error)
    return pool_hashrate
  })
}

// Calculate total_shares for all non matured blocks
const query_generate_total_shares = {
  name: 'generate-total-shares',
  text: `
  UPDATE
  mined_blocks
  SET
  total_shares = sub.total_shares
  FROM (
    SELECT
    blk_id,
    SUM(COALESCE(count, 0)) AS total_shares
    FROM (
      SELECT
      blk_id,
      status,
      total_shares,
      LAG(time, 1, 0) OVER(ORDER BY height ASC) AS time_start,
      time AS time_end
      FROM mined_blocks
      WHERE status > 0
    ) blocks
    LEFT JOIN (
      SELECT
      time,
      count
      FROM valid_shares
    ) shares ON time > time_start AND time <= time_end
    WHERE status < 5
    GROUP BY 1
  ) sub
  WHERE mined_blocks.blk_id = sub.blk_id
  `
}

export function generateTotalShares() {
  return pool.query(query_generate_total_shares).then(res => {
    logger.log('info', 'global', 'Generated total shares for %d blocks', [res.rowCount])
  }).catch(error => {
    logger.log('error', 'global', 'Failed to generate total shares')
    logger.log('error', 'global', error)
  })
}

const query_get_total_shares_since = {
  name: 'get-total-shares-since',
  text: `
  SELECT COALESCE(SUM(count), 0) AS count
  FROM valid_shares
  WHERE time > $1
  `
}

export function getTotalSharesSince(start_time) {
  start_time = time.walltime_to_db_time(start_time)
  return pool.query(query_get_total_shares_since.text, [start_time]).then(res => {
    return res.rows[0].count
  }).catch(error => {
    logger.log('error', 'global', 'Failed to get total shares since %d', [start_time])
    logger.log('error', 'global', error)
    return 0
  })
}

// Calculate average effort
const query_get_average_efforts = {
  name: 'get-average-efforts',
  text: `
  SELECT
  SUM(total_shares) AS total_shares,
  SUM(difficulty) AS difficulty,
  size
  FROM(
    (
      SELECT total_shares, difficulty, 100 AS size
      FROM mined_blocks
      WHERE status > 0
      ORDER BY blk_id DESC
      LIMIT 100
    )
    UNION ALL
    (
      SELECT total_shares, difficulty, 1000 AS size
      FROM mined_blocks
      WHERE status > 0
      ORDER BY blk_id DESC
      LIMIT 1000
    )
    UNION ALL
    (
      SELECT total_shares, difficulty, 0 AS size
      FROM mined_blocks
      WHERE status > 0
    )
  ) AS sub
  GROUP BY size
  `
}

export function getAverageEfforts() {
  let data = {
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
  }
  return pool.query(query_get_average_efforts).then(res => {
    res.rows.forEach(row => {
      const key = row.size === 0 ? 'all' : `last_${row.size}`
      data[key] = {
        total_shares: row.total_shares,
        difficulty: row.difficulty
      }
    })
    return data
  }).catch(error => {
    logger.log('error', 'global', 'Failed to get average efforts')
    logger.log('error', 'global', error)
    return data
  })
}

const query_get_blocks_count = {
  name: 'get-blocks-count',
  text: `
  SELECT
    COUNT(*)::INT AS blocks_total,
    SUM(CASE WHEN status = -1 THEN 1 ELSE 0 END)::INT AS blocks_orphaned,
    SUM(CASE WHEN status =  0 THEN 1 ELSE 0 END)::INT AS blocks_failed,
    SUM(CASE WHEN status =  1 THEN 1 ELSE 0 END)::INT AS blocks_ok,
    SUM(CASE WHEN status =  2 THEN 1 ELSE 0 END)::INT AS blocks_tx_seen,
    SUM(CASE WHEN status =  3 THEN 1 ELSE 0 END)::INT AS blocks_credited,
    SUM(CASE WHEN status =  4 THEN 1 ELSE 0 END)::INT AS blocks_matured,
    SUM(CASE WHEN status =  5 THEN 1 ELSE 0 END)::INT AS blocks_closed,
    SUM(CASE WHEN status >  0 THEN COALESCE(reward_total, 0) ELSE 0 END) AS total_mined
  FROM mined_blocks
  `
}
export function getBlocksCount() {
  return pool.query(query_get_blocks_count.text).then(res => {
    return res.rows[0]
  }).catch(error => {
    logger.log('error', 'global', 'Error getting blocks count')
    logger.log('error', 'global', error)
    return {
      blocks_total: 0,
      blocks_orphaned: 0,
      blocks_failed: 0,
      blocks_ok: 0,
      blocks_tx_seen: 0,
      blocks_credited: 0,
      blocks_matured: 0,
      blocks_closed: 0,
      total_mined: 0
    }
  })
}

const query_get_payment_count = {
  name: 'get-payment-count',
  text: `
  SELECT
    COUNT(*)::INT AS payment_total,
    SUM(CASE WHEN status = -1 THEN 1 ELSE 0 END)::INT AS payment_orphaned,
    SUM(CASE WHEN status =  0 THEN 1 ELSE 0 END)::INT AS payment_pending,
    SUM(CASE WHEN status =  1 THEN 1 ELSE 0 END)::INT AS payment_matured,
    SUM(CASE WHEN status > -1 THEN COALESCE(amount_paid, 0) ELSE 0 END) AS total_paid,
    SUM(CASE WHEN status > -1 THEN COALESCE(amount_fee, 0) ELSE 0 END) AS total_fee,
    COUNT(DISTINCT uid) AS total_payees
  FROM payments
  `
}

export function getPaymentCount() {
  return pool.query(query_get_payment_count.text).then(res => {
    return res.rows[0]
  }).catch(error => {
    logger.log('error', 'global', 'Error getting payments count')
    logger.log('error', 'global', error)
    return {
      payment_total: 0,
      payment_orphaned: 0,
      payment_pending: 0,
      payment_matured: 0,
      total_paid: 0,
      total_fee: 0,
      total_payees: 0
    }
  })
}
